// Requires morse.js and morseTable.js

// Global variables
var fakePlayer;
var messageArea;
var extraStyle;
var context;
var panNode;
var volGain;
var pauseGain;
var oscillator;

var audioBufferDurationDefault = 0.1;
var audioBufferDurationBackground = 2;  // Chrome and other browsers throttle timer updates
                                        // to once a second or less often in the background
var audioBufferUpdate = 0.05;
var highlightEarlyFactor = 0.9;  // [0 to 1] Fraction of the letter gap time to highlight before the letter plays
var toneSmoothTime = 0.003;
var pauseSmoothTime = 0.2;
var frequency = 750;  // Default frequency
var pan = 0;
var volume = 1;
var wpm = 27;  // Words per minute
var fs = 9;  // Farnsworth speed
var playingMessage = null;
var currentIndex = 0;
var highlightBuffer = [];

var audioBufferDuration = audioBufferDurationDefault;
var nextStartTime = 0;
var nextEndTime = 0.1;
var playing = false;
var ignoreNextPause = false;

var currentCharacterStartTime = 0;
var currentCharacterElapsedTime = 0;
var currentCharacter = '';

var allowBeep = true;

function displayBackgroundAudioNotification() {
  document.getElementById("enableKeyBeep").style.display = "";
}

document.addEventListener('DOMContentLoaded', () => {
  (document.querySelectorAll('.notification .delete') || []).forEach(($delete) => {
    const $notification = $delete.parentNode;

    $delete.addEventListener('click', () => {
      $notification.parentNode.removeChild($notification);
    });
  });
});

setTimeout(loadBackgroundAudioNotification, 0);

var layout = {
  title: 'Tally Board',
  yaxis: {
    showticklabels: false,
    title: 'Relative Response Time'
  }
};

var learningTable = {};
Object.keys(forwardTable).forEach(function(key, index) {
  learningTable[key] = 9.999;
});

var plotData =[
  {
    x: Object.keys(learningTable),
    y: Object.values(learningTable).map(m => m == 9.999 ? 0 : m),
    type: 'bar',
    hoverinfo: 'skip'
  }
];
setTimeout(() => { Plotly.newPlot('tally', plotData, layout)}, 0);

function beep(duration, frequency, volume){
  return new Promise((resolve, reject) => {
    duration = duration || 200;
    frequency = frequency || 440;
    volume = volume || 100;

    try{
      let oscillatorNode = context.createOscillator();
      let gainNode = context.createGain();
      oscillatorNode.connect(gainNode);

      // Set the oscillator frequency in hertz
      oscillatorNode.frequency.value = frequency;

      // Set the type of oscillator
      oscillatorNode.type= "square";
      gainNode.connect(context.destination);

      // Set the gain to the volume
      gainNode.gain.value = volume * 0.01;

      // Start audio with the desired duration
      oscillatorNode.start(context.currentTime);
      oscillatorNode.stop(context.currentTime + duration * 0.001);

      // Resolve the promise when the sound is finished
      oscillatorNode.onended = () => {
          resolve();
      };
    }catch(error){
      reject(error);
    }
  });
}

function weighted_random(items, weights) {
  var i;
  for (i = 0; i < weights.length; i++) {
    weights[i] += weights[i - 1] || 0;
  }
  var random = Math.random() * weights[weights.length - 1];
  for (i = 0; i < weights.length; i++) {
    if (weights[i] > random) {
      break;
    }
  }
  return items[i];
}

function beepSuccess() {
  if (!allowBeep) { return; }
  beep(80, 1800, 10);
}
function beepFailure() {
  if (!allowBeep) { return; }
  beep(
    // Set the duration to 0.2 second (200 milliseconds)
    200,
    // Set the frequency of the note to A4 (440 Hz)
    200,
    // Set the volume of the beep to 100%
    100
  );
}
function beepTimeout() {
  if (!allowBeep) { return; }
  beep(130, 300, 20);
}


window.addEventListener('load', initPlay, false);
window.addEventListener('keydown', function (e) {
  if (e.key == 'Shift' || !playing) { return; }
  if (currentCharacter.toUpperCase() == e.key.toUpperCase()) {
    currentCharacterElapsedTime = Date.now() - currentCharacterStartTime;
    beepSuccess();
    function approxRollingAverage(avg, new_sample) {
      avg = avg || 0.01;
      new_sample = new_sample || 0.01;
      var N = 10;
      avg -= avg / N;
      avg += new_sample / N;
      return avg;
    }
    learningTable[currentCharacter] = approxRollingAverage(learningTable[currentCharacter], currentCharacterElapsedTime / 1000);
    plotData =[
      {
        x: Object.keys(learningTable),
        y: Object.values(learningTable).map(m => m == 9.999 ? 0 : m),
        type: 'bar',
        hoverinfo: 'skip'
      }
    ];
    Plotly.react('tally', plotData, layout);
  } else {
    // Simple beep
    beepFailure();
  }
}, false);


function initPlay() {
  initAudioContext();
  initExtraStyle();

  messageArea = document.getElementById("messageArea");

  loadSavedFrequency();
  loadSavedPan();
  loadSavedVolume(true);
  loadSavedWpm();
  loadSavedFs();
  loadCurrentIndex();
  loadSavedTimes();
  highlightLetterIndex(currentIndex);
}
function initExtraStyle() {
  var style = document.createElement("style");
  document.head.appendChild(style);
  extraStyle = style.sheet;
  extraStyle.insertRule("#dummy {}", 0);
}
function initAudioContext() {
  window.AudioContext = window.AudioContext||window.webkitAudioContext||null;
  if (window.AudioContext !== null) {
    context = new AudioContext();
  } else {
    // Audio not supported
    context = null;
    showSupportError();
  }
  if (context) {
    volGain = context.createGain();
    if (context.createStereoPanner) {
      panNode = context.createStereoPanner();
    } else {
      panNode = context.createGain();
    }
    panNode.connect(context.destination);
    volGain.connect(panNode);
  }
}
function showSupportError() {
  document.getElementById("supportError").style.display = "";
}
function enableMobileBackgroundAudio() {
  document.getElementById("enableBackground").style.display = "none";
  document.getElementById("disableBackground").style.display = "";
  if (!fakePlayer) {
    if (playing) ignoreNextPause = true;
    fakePlayer = new Audio();
    fakePlayer.loop = true;
    fakePlayer.muted = true;
    fakePlayer.onplay = playMorse();
    fakePlayer.onpause = pauseMorse();
    document.body.appendChild(fakePlayer);
    if (playing) setTimeout(function() {ignoreNextPause = false;}, 100);
  }
  audioBufferDuration = audioBufferDurationBackground;
  context.resume();

  ["playbutton", "pausebutton", "restartbutton"].forEach(id => {
    var element = document.getElementById(id);
    element.removeAttribute("disabled");
  });
}
function disableMobileBackgroundAudio() {
  document.getElementById("enableBackground").style.display = "";
  document.getElementById("disableBackground").style.display = "none";
  if (fakePlayer) {
    fakePlayer.onplay = null;
    fakePlayer.onpause = null;
    fakePlayer.parentNode.removeChild(fakePlayer);
    fakePlayer = null;
  }
  audioBufferDuration = audioBufferDurationDefault;
}
function disableKeyBeep() {
  document.getElementById("enableKeyBeep").style.display = "";
  document.getElementById("disableKeyBeep").style.display = "none";
  allowBeep = false;
}
function enableKeyBeep() {
  document.getElementById("enableKeyBeep").style.display = "none";
  document.getElementById("disableKeyBeep").style.display = "";
  allowBeep = true;
}

// Frequency setting
function frequencyButtonPress(f) {
  document.getElementById("freqText").value = f;
  setFrequencySlider(f);
  setFrequency(f);
}
function frequencyTextChange() {
  var f = parseFloat(document.getElementById("freqText").value);
  setFrequencySlider(f);
  setFrequency(f);
}
function frequencySliderChange() {
  var fExp = parseFloat(document.getElementById("freqSlider").value);
  var f = Math.round(Math.pow(10, fExp));
  document.getElementById("freqText").value = f;
  setFrequency(f);
}
function setFrequencySlider(f) {
  var fExp = Math.log10(f);
  document.getElementById("freqSlider").value = fExp;
}
function setFrequency(f) {
  frequency = f;
  localStorage.frequency = f+"";
  setOscillatorFrequency(f);
}
function loadSavedFrequency() {
  if (typeof localStorage.frequency == "string") {
    frequency = parseFloat(localStorage.frequency);
  } // Else don't change the frequency
  setFrequencySlider(frequency);
  document.getElementById("freqText").value = frequency;
  setOscillatorFrequency(frequency);
}
function loadBackgroundAudioNotification() {
  var timesShownBackgroundAudioNotice = parseInt(localStorage.backgroundAudioNotice) || 0;
  if (timesShownBackgroundAudioNotice < 2) {
    document.getElementById("backgroundAudioNotification").style.display = "";
    setBackgroundAudioNotification(++timesShownBackgroundAudioNotice)
  }
}
function setBackgroundAudioNotification(timesShownBackgroundAudioNotice) {
  localStorage.backgroundAudioNotice = timesShownBackgroundAudioNotice;
}

// Left-right pan setting
function panTextChange() {
  var f = parseFloat(document.getElementById("panText").value);
  document.getElementById("panSlider").value = f;
  setPan(f);
}
function panSliderChange() {
  var f = parseFloat(document.getElementById("panSlider").value);
  document.getElementById("panText").value = f;
  setPan(f);
}
function setPan(f) {
  pan = f;
  localStorage.pan = f+"";
  setOscillatorPan(f);
}
function loadSavedPan() {
  if (typeof localStorage.pan == "string") {
    pan = parseFloat(localStorage.pan);
  }
  document.getElementById("panSlider").value = pan;
  document.getElementById("panText").value = pan;
  setOscillatorPan(pan);
}

// Volume setting
function volumeTextChange() {
  var f = parseFloat(document.getElementById("volText").value);
  document.getElementById("volSlider").value = f;
  setVolume(f);
}
function volumeSliderChange() {
  var f = parseFloat(document.getElementById("volSlider").value);
  document.getElementById("volText").value = f;
  setVolume(f);
}
function setVolume(f) {
  volume = f;
  localStorage.volume = f+"";
  setOscillatorVolume(f);
}
function loadSavedVolume(initial) {
  if (typeof localStorage.volume == "string") {
    volume = parseFloat(localStorage.volume);
  }
  document.getElementById("volSlider").value = volume;
  document.getElementById("volText").value = volume;
  setOscillatorVolume(volume, initial);
}

// Words per minute setting
function wpmTextChange() {
  var f = parseFloat(document.getElementById("wpmText").value);
  document.getElementById("wpmSlider").value = f;
  setWpm(f);
}
function wpmSliderChange() {
  var f = parseFloat(document.getElementById("wpmSlider").value);
  document.getElementById("wpmText").value = f;
  setWpm(f);
}
function setWpm(f) {
  wpm = f;
  localStorage.wpm = f+"";
}
function loadSavedWpm() {
  if (typeof localStorage.wpm == "string") {
    wpm = parseFloat(localStorage.wpm);
  }
  document.getElementById("wpmSlider").value = wpm;
  document.getElementById("wpmText").value = wpm;
}

// Farnsworth speed setting
function fsTextChange() {
  var f = parseFloat(document.getElementById("fsText").value);
  document.getElementById("fsSlider").value = f;
  setFs(f);
}
function fsSliderChange() {
  var f = parseFloat(document.getElementById("fsSlider").value);
  document.getElementById("fsText").value = f;
  setFs(f);
}
function setFs(f) {
  fs = f;
  localStorage.fs = f+"";
}
function loadSavedFs() {
  if (typeof localStorage.fs == "string") {
    fs = parseFloat(localStorage.fs);
  }
  document.getElementById("fsSlider").value = fs;
  document.getElementById("fsText").value = fs;
}

// Saved message index
function loadCurrentIndex() {
  if (typeof localStorage.currentIndex == "string") {
    currentIndex = parseInt(localStorage.currentIndex);
  }
}
function saveCurrentIndex() {
  localStorage.currentIndex = currentIndex+"";
}

function loadSavedTimes() {
  if (typeof localStorage.savedTimes == "string") {
    learningTable = JSON.parse(localStorage.savedTimes);
    plotData =[
      {
        x: Object.keys(learningTable),
        y: Object.values(learningTable).map(m => m == 9.999 ? 0 : m),
        type: 'bar',
        hoverinfo: 'skip'
      }
    ];
    setTimeout(() => { Plotly.react('tally', plotData, layout)}, 0);
    //Plotly.react('tally', plotData);
  }
}
function saveSavedTimes() {
  localStorage.savedTimes = JSON.stringify(learningTable);
}

// Log
function appendLog(message) {
  console.log(message);
}


// Letter highlighting
function highlightLetterIndex(i) {
  extraStyle.deleteRule(0);
  var style = "{background:#FFDD00}";
  if (playingMessage) {
    if (playingMessage[i] == '\n') {
      style = "{background:#FFDD00; padding-left:0.4em;}";
    }
  }
  extraStyle.insertRule("#messageArea > span:nth-of-type("+(i+1)+") "+style, 0);
}

// Sound generation
function scheduleBeep(t, dur) {
  if (!pauseGain) {
    pauseGain = context.createGain();
    pauseGain.connect(volGain);
  }
  var o = context.createOscillator();
  var g = context.createGain();
  o.type = "sine";
  o.frequency.value = frequency;
  o.connect(g);
  g.connect(pauseGain);
  o.start(t);
  g.gain.value = 0;
  g.gain.setValueAtTime(0, t);
  g.gain.linearRampToValueAtTime(1, t+toneSmoothTime);
  g.gain.setValueAtTime(1, t+dur);
  g.gain.linearRampToValueAtTime(0, t+dur+toneSmoothTime);
  o.stop(t+dur+toneSmoothTime);
}
function scheduleTimeArr(t, timeArr, dur) {
  timeArr.forEach(function(timing) {
    scheduleBeep(t+timing[0], timing[1]);
  });
}
function scheduleMorseChar(t, i) {
  info = messageToTimeArr(playingMessage, i, wpm, fs);
  scheduleTimeArr(t, info.timeArr, info.duration);
  return t + info.duration;
}
function bufferAudio() {
  if (!playing) return;

  var t = context.currentTime;
  var dur;
  var highlightEarly = calcHightlightEarly();
  var forward = Math.max(highlightEarly, audioBufferDuration);

  while (nextStartTime <= t + forward) {

    if (currentIndex >= playingMessage.length) {
      playing = false;
      currentIndex = 0;
      pushHighlightBuffer(nextStartTime, currentIndex);
      return;  // Done playing
    }
    playingMessage.push(weighted_random(Object.keys(learningTable), Object.values(learningTable).map(m => m == 0 ? 9.999 : m )));

    currentCharacterStartTime = Date.now();
    currentCharacter = playingMessage[(currentIndex - 1) < 0 ? 0 : currentIndex - 1];
    pushHighlightBuffer(nextStartTime, currentIndex);
    nextStartTime = scheduleMorseChar(nextStartTime, currentIndex);
    nextEndTime = scheduleMorseChar(nextStartTime, currentIndex + 1 ) - 0.001;
    saveCurrentIndex();
    currentIndex++;
  }
  setTimeout(bufferAudio, audioBufferUpdate);
}
function pushHighlightBuffer(t, i) {
  highlightBuffer.push([t, i]);
}
function drawHighlights() {
  if (!playing) return;

  requestAnimationFrame(drawHighlights);

  var highlightEarly = calcHightlightEarly();

  var t = context.currentTime;
  var i = null;
  while (highlightBuffer.length > 0 && highlightBuffer[0][0] <= t+highlightEarly) {
    i = highlightBuffer.shift()[1];
  }
  if (i !== null) {
    highlightLetterIndex(i);
  }
}
function calcHightlightEarly() {
  var farnsworthScale = farnsworthScaleFactor(wpm, fs);
  var sbLetter = 1/wpmToDps(wpm) * CHAR_SPACE * farnsworthScale;
  return sbLetter * highlightEarlyFactor;
}


function playMorse() {
  if (playing) return;

  playingMessage = [''];

  if (currentIndex > 0) {
    currentIndex--;
  }
  nextStartTime = context.currentTime + 0.1;
  nextEndTime = context.currentTime + nextStartTime - 0.001;

  playing = true;
  bufferAudio();
  highlightBuffer = [];
  drawHighlights();

  appendLog("Play");
}
function pauseMorse() {
  if (ignoreNextPause) {
    ignoreNextPause = false;
    return;
  }

  if (pauseGain) {
    var t = context.currentTime;
    pauseGain.gain.linearRampToValueAtTime(0, t+pauseSmoothTime);
    pauseGain = null;
  }
  playing = false;
  saveSavedTimes();

  appendLog("Pause");
}
function restartMorse() {
  currentIndex = 0;
  appendLog("Restart");
  playMorse();
}


// Update audio manipulation settings
function setOscillatorFrequency(f) {
  if (oscillator) {
    oscillator.frequency.value = f;
  }
}
function setOscillatorPan(p) {
  if (context.createStereoPanner) {
    panNode.pan.value = p;
  }
}
function setOscillatorVolume(v, initial) {
  if (v <= 0.01) v = 0;
  var ve = Math.pow(2,v)-1;
  if (initial) {
    volGain.gain.value = ve;
  } else {
    volGain.gain.linearRampToValueAtTime(
      ve, context.currentTime + 0.01
    );
  }
}


