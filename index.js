// LinuxServer KasmVNC Client

//// Env variables ////
var CUSTOM_USER = process.env.CUSTOM_USER || 'abc';
var PASSWORD = process.env.PASSWORD || 'abc';
var SUBFOLDER = process.env.SUBFOLDER || '/';
var TITLE = process.env.TITLE || 'KasmVNC Client';
var FM_HOME = process.env.FM_HOME || '/config';
var PATH;
if (SUBFOLDER != '/') {
  PATH = '&path=' + SUBFOLDER.substring(1) + 'websockify'
} else {
  PATH = false;
}
//// Application Variables ////
var socketIO = require('socket.io');
var express = require('express');
var path_node = require('path');
var morgan = require('morgan');
var ejs = require('ejs');
var app = express();
var http = require('http').createServer(app);
var bodyParser = require('body-parser');
var baseRouter = express.Router();
var fsw = require('fs').promises;
var fs = require('fs');
// Audio init
var audioEnabled = true;
var PulseAudio = require('pulseaudio2');
var pulse = new PulseAudio();
pulse.on('error', function(error) {
  console.error("[kclient] pulse audio error: ", error);
  audioEnabled = false;
  console.log('[kclient] Kclient was unable to init audio, it is possible your host lacks support!!!!');
});
var port = 6900;

//// Server Paths Main ////
var public_dir = path_node.join(__dirname, 'public');

app.engine('html', ejs.renderFile);
app.engine('json', ejs.renderFile);
app.use(morgan('combined'));

//// Routes ////
baseRouter.get('/ping', function (req, res) {
  res.send("pong");
});
baseRouter.get('/favicon.ico', function (req, res) {
  res.sendFile(path_node.join(public_dir, 'favicon.ico'));
});
baseRouter.get('/', function (req, res) {
  res.render(path_node.join(public_dir, 'index.html'), {title: TITLE, path: PATH, path_prefix: SUBFOLDER});
});
baseRouter.get('/manifest.json', function (req, res) {
  res.render(path_node.join(public_dir, 'manifest.json'), {title: TITLE, path_prefix: SUBFOLDER});
});
baseRouter.get('/files', function (req, res) {
  res.render(path_node.join(public_dir, 'filebrowser.html'), {path_prefix: SUBFOLDER});
});
baseRouter.use('/vnc', express.static("/usr/share/kasmvnc/www/"));
app.use(SUBFOLDER, baseRouter);

// Websocket comms //
var io = socketIO(http, {path: SUBFOLDER + 'files/socket.io', maxHttpBufferSize: 200000000});
io.on('connection', async function (socket) {
  let id = socket.id;

  //// Functions ////

  // Open default location
  async function checkAuth(password) {
    getFiles(FM_HOME);
  }

  // Emit to user
  function send(command, data) {
    io.sockets.to(id).emit(command, data);
  }

  // Get file list for directory
  async function getFiles(directory) {
    try {
      if (fs.existsSync(directory)) {
        let items = await fsw.readdir(directory);
        if (items.length > 0) {
          let dirs = [];
          let files = [];
          for await (let item of items) {
            let fullPath = directory + '/' + item;
            if (fs.lstatSync(fullPath).isDirectory()) {
              dirs.push(item);
            } else {
              files.push(item);
            }
          }
          send('renderfiles', [dirs, files, directory]);
        } else {
          send('renderfiles', [[], [], directory]);
        }
      } else {
        send('renderfiles', [[], [], directory]);
      }
    } catch (error) {
      console.error("[kclient] getFiles error: ", error);
      send('renderfiles', [[], [], directory]);
    }
  }

  // Send file to client
  async function downloadFile(file) {
    try {
      let fileName = file.split('/').slice(-1)[0];
      let data = await fsw.readFile(file);
      send('sendfile', [data, fileName]);
    } catch (error) {
      console.error("[kclient] Error on downloadFile: ", error);
    }
  }

  // Write client sent file
  async function uploadFile(res) {
    try {
      let directory = res[0];
      let filePath = res[1];
      let data = res[2];
      let render = res[3];
      let dirArr = filePath.split('/');
      let folder = filePath.replace(dirArr[dirArr.length - 1], '')
      
      await fsw.mkdir(folder, { recursive: true });
      await fsw.writeFile(filePath, Buffer.from(data));
      
      if (render) {
        getFiles(directory);
      }
    } catch (error) {
      console.error("[kclient] Error on uploadFile: ", error);
    }
  }

  // Delete files
  async function deleteFiles(res) {
    try {
      let item = res[0];
      let directory = res[1];
      item = item.replace("|","'");
      if (fs.lstatSync(item).isDirectory()) {
        await fsw.rm(item, {recursive: true});
      } else {
        await fsw.unlink(item);
      }
      getFiles(directory);
    } catch (error) {
      console.error("[kclient] Error on deleteFiles: ", error);
    }
  }

  // Create a folder
  async function createFolder(res) {
    let dir = res[0];
    let directory = res[1];
    try {
      await fsw.mkdir(dir, { recursive: true });
    } catch (error) {
      console.info("[kclient] Dir exists!");
    }
    getFiles(directory);
  }

  // Incoming socket requests
  socket.on('open', checkAuth);
  socket.on('getfiles', getFiles);
  socket.on('downloadfile', downloadFile);
  socket.on('uploadfile', uploadFile);
  socket.on('deletefiles', deleteFiles);
  socket.on('createfolder', createFolder);
});

//// PCM Audio Wrapper ////
var aio = socketIO(http, {path: SUBFOLDER + 'audio/socket.io'});
aio.on('connection', function (socket) {
  var record;
  let id = socket.id;

  function open() {
    if (audioEnabled) {
      if (record) record.end();
      record = pulse.createRecordStream({
                 device: 'auto_null.monitor',
                 channels: 2,
                 rate: 44100,
                 format: 'S16LE',
               });
      record.on('connection', function(){
        record.on('data', function(chunk) {
          // Only send non-zero audio data
          let i16Array = Int16Array.from(chunk);
          if (! i16Array.every(item => item === 0)) {
            aio.sockets.to(id).emit('audio', chunk);
          }
        });
      });
    }
  }
  function close() {
    console.info('[kclient] audio socket closed.');
    if (audioEnabled) {
      if (record) record.end();
    }
  }

  // Dump blobs to pulseaudio sink
  async function micData(buffer) {
    try {
      await fsw.writeFile('/defaults/mic.sock', buffer);
    } catch (error) {
      console.error('[kclient] Error on micData: ' + error);
    }
  }

  // Incoming socket requests
  socket.on('open', open);
  socket.on('close', close);
  socket.on('disconnect', close);
  socket.on('micdata', micData);
});

// Spin up application on port
http
  .listen(port, function() {
    console.log('[kclient] Listening on port ' + port);
  })
  .on('error', function(err) {
    console.log('[kclient] Error on http server: ');
    console.error(err);
  });

process
  .on('unhandledRejection', function (reason, p) {
    console.error('[kclient] Unhandled Rejection at:', p, 'reason:', reason);
  })
  .on('uncaughtException', function (err) {
    console.log('[kclient] Uncaught exception: ');
    console.error(err.stack);
  });
