// Parse messages from KasmVNC
var eventMethod = window.addEventListener ? "addEventListener" : "attachEvent";
var eventer = window[eventMethod];
var messageEvent = eventMethod == "attachEvent" ? "onmessage" : "message";
eventer(messageEvent,function(e) {
  if (event.data && event.data.action) {
    switch (event.data.action) {
      case 'control_open':
        openToggle('#lsbar');
        break;
      case 'control_close':
        closeToggle('#lsbar');
        break;
      case 'fullscreen':
        fullscreen();
        break;
    }
  }
},false);


// Handle Toggle divs
function openToggle(id) {
  if ($(id).is(":hidden")) {
    $(id).slideToggle(300);
  }
}
function closeToggle(id) {
  if ($(id).is(":visible")) {
    $(id).slideToggle(300);
  }
}
function toggle(id) {
  $(id).slideToggle(300);
}

// Fullscreen handler
function fullscreen() {
  if (document.fullscreenElement || document.mozFullScreenElement || document.webkitFullscreenElement || document.msFullscreenElement) {
    if (document.exitFullscreen) {
      document.exitFullscreen();
    } else if (document.mozCancelFullScreen) {
      document.mozCancelFullScreen();
    } else if (document.webkitExitFullscreen) {
      document.webkitExitFullscreen();
    } else if (document.msExitFullscreen) {
      document.msExitFullscreen();
    }
  } else {
    if (document.documentElement.requestFullscreen) {
      document.documentElement.requestFullscreen();
    } else if (document.documentElement.mozRequestFullScreen) {
      document.documentElement.mozRequestFullScreen();
    } else if (document.documentElement.webkitRequestFullscreen) {
      document.documentElement.webkitRequestFullscreen(Element.ALLOW_KEYBOARD_INPUT);
    } else if (document.body.msRequestFullscreen) {
      document.body.msRequestFullscreen();
    }
  }
}

// Websocket comms for audio
var host = window.location.hostname;
var port = window.location.port;
var protocol = window.location.protocol;
var path = window.location.pathname;
var socket = io(protocol + '//' + host + ':' + port, { path: path + 'audio/socket.io'});
var player = {};
var micEnabled = false;

function audio() {
  if (('audioCtx' in player) && (player.audioCtx)) {
    player.destroy();
    socket.emit('close', '');
    $('#audioButton').removeClass("icons-selected");
    return;
  }
  socket.emit('open', '');
  player = new PCMPlayer();
  $('#audioButton').addClass("icons-selected");
}

function processAudio(data) {
  player.feed(data);
}

socket.on('audio', processAudio);

var audio_context;
function mic() {
  if (micEnabled) {
    $('#micButton').removeClass("icons-selected");
    audio_context.close();
    micEnabled = false;
    return;
  }
  $('#micButton').addClass("icons-selected");
  micEnabled = true;
  var mediaConstraints = {
    audio: true
  };
  navigator.getUserMedia(mediaConstraints, onMediaSuccess, onMediaError);
  function onMediaSuccess(stream) {
    audio_context = new window.AudioContext;
    let source = audio_context.createMediaStreamSource(stream);
    let processor = audio_context.createScriptProcessor(2048, 1, 1);
    source.connect(processor);
    processor.connect(audio_context.destination);
    processor.onaudioprocess = function (audioEvent) {
      let int16Array = Int16Array.from(audioEvent.inputBuffer.getChannelData(0), x => x * 32767);
      let arraySize = new Blob([JSON.stringify(int16Array)]).size;
      if (arraySize > 20000) {
        socket.emit('micdata', int16Array.buffer);
      }
    };
  }
  function onMediaError(e) {
    console.error('media error', e);
  }
}
