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

//// PCM player ////
var buffer = [];
var playing = false;
var lock = false;
// Check for audio stop to reset buffer
setInterval(function() {
  if (playing) {
    if (!lock) {
      buffer = [];
      playing = false;
    }
    lock = false;
  }
}, 100);
function PCM() {
  this.init()
}
// Player Init
PCM.prototype.init = function() {
  // Establish audio context
  this.audioCtx = new(window.AudioContext || window.webkitAudioContext)({
    sampleRate: 44100
  })
  this.audioCtx.resume()
  this.gainNode = this.audioCtx.createGain()
  this.gainNode.gain.value = 1
  this.gainNode.connect(this.audioCtx.destination)
  this.startTime = this.audioCtx.currentTime
}
// Stereo player
PCM.prototype.feed = function(data) {
  lock = true;
  // Convert bytes to typed array then float32 array
  let i16Array = new Int16Array(data, 0, data.length);
  let f32Array = Float32Array.from(i16Array, x => x / 32767);
  buffer = new Float32Array([...buffer, ...f32Array]);
  let buffAudio = this.audioCtx.createBuffer(2, buffer.length, 44100);
  let duration = buffAudio.duration / 2;
  if ((duration > .05) || (playing)) {
    playing = true;
    let buffSource = this.audioCtx.createBufferSource();
    let arrLength = buffer.length / 2;
    let left = buffAudio.getChannelData(0);
    let right = buffAudio.getChannelData(1);
    let byteCount = 0;
    let offset = 1;
    for (let count = 0; count < arrLength; count++) {
      left[count] = buffer[byteCount];
      byteCount += 2;
      right[count] = buffer[offset];
      offset += 2;
    }
    buffer = [];
    if (this.startTime < this.audioCtx.currentTime) {
      this.startTime = this.audioCtx.currentTime;
    }
    buffSource.buffer = buffAudio;
    buffSource.connect(this.gainNode);
    buffSource.start(this.startTime);
    this.startTime += duration;
  }
}
// Destroy player
PCM.prototype.destroy = function() {
  buffer = [];
  playing = false;
  this.audioCtx.close();
  this.audioCtx = null;
};

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
var micWorkletNode; // To store the AudioWorkletNode
var audio_context;

function audio() {
  if (('audioCtx' in player) && (player.audioCtx)) {
    player.destroy();
    socket.emit('close', '');
    $('#audioButton').removeClass("icons-selected");
    return;
  }
  socket.emit('open', '');
  player = new PCM();
  $('#audioButton').addClass("icons-selected");
}

function processAudio(data) {
  player.feed(data);
}

socket.on('audio', processAudio);

// Define the AudioWorkletProcessor as a string.
const micWorkletProcessorCode = `
class MicWorkletProcessor extends AudioWorkletProcessor {
  constructor() {
    super();
  }

  process(inputs, outputs, parameters) {
    const input = inputs[0];

    if (input && input[0]) { // Check if input and channel data are available
      const inputChannelData = input[0];
      const int16Array = Int16Array.from(inputChannelData, x => x * 32767);
      if (! int16Array.every(item => item === 0)) {
        this.port.postMessage({ buffer: int16Array.buffer });
      }
    }
    return true; // Keep the processor alive
  }
}

registerProcessor('mic-worklet-processor', MicWorkletProcessor);
`;

async function mic() {
  if (micEnabled) {
    $('#micButton').removeClass("icons-selected");
    if (micWorkletNode) {
      micWorkletNode.disconnect();
      micWorkletNode = null; // Release the node
    }
    if (audio_context) {
      audio_context.close();
      audio_context = null;
    }
    micEnabled = false;
    return;
  }
  $('#micButton').addClass("icons-selected");
  micEnabled = true;
  var mediaConstraints = {
    audio: true
  };

  try {
    const stream = await navigator.mediaDevices.getUserMedia(mediaConstraints);
    audio_context = new window.AudioContext();

    // Create a URL for the AudioWorkletProcessor code
    const micWorkletProcessorBlob = new Blob([micWorkletProcessorCode], { type: 'text/javascript' });
    const micWorkletProcessorURL = URL.createObjectURL(micWorkletProcessorBlob);

    await audio_context.audioWorklet.addModule(micWorkletProcessorURL);

    micWorkletNode = new AudioWorkletNode(audio_context, 'mic-worklet-processor');

    micWorkletNode.port.onmessage = (event) => {
      socket.emit('micdata', event.data.buffer);
    };

    let source = audio_context.createMediaStreamSource(stream);
    source.connect(micWorkletNode);

  } catch (e) {
    console.error('media error', e);
    $('#micButton').removeClass("icons-selected");
    micEnabled = false;
  }
}
