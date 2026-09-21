// app-clock.js: cronómetro, minutos jugados y alineación en pista
// ---- Gestión de tiempo: cronómetro, fase, alineación en pista y minutos jugados ----
const MATCH_DURATION_MS = 60 * 60 * 1000; // 60 minutos

function getClock(match){
  if(!match.clock){
    match.clock = { elapsedMs: 0, running:false, startedAt:null, timeoutsUsed:0 };
  }
  const c = match.clock;
  if(c.timeoutsUsed === undefined) c.timeoutsUsed = 0;
  // Migra partidos creados con el modelo antiguo (cuenta atrás con remainingMs/targetEndTs)
  if(c.elapsedMs === undefined){
    const wasRunning = !!c.running;
    const actualRemainingNow = (wasRunning && c.targetEndTs)
      ? Math.max(0, c.targetEndTs - Date.now())
      : (c.remainingMs !== undefined ? c.remainingMs : MATCH_DURATION_MS);
    c.elapsedMs = Math.max(0, MATCH_DURATION_MS - actualRemainingNow);
    c.startedAt = wasRunning ? Date.now() : null;
    delete c.remainingMs;
    delete c.targetEndTs;
  }
  return c;
}
// Tiempo transcurrido del partido (sube de 0 a 60 minutos)
function clockElapsedMs(match){
  const c = getClock(match);
  if(c.running && c.startedAt) return Math.min(MATCH_DURATION_MS, c.elapsedMs + (Date.now() - c.startedAt));
  return Math.min(MATCH_DURATION_MS, c.elapsedMs);
}
function fmtClock(ms){
  const totalSec = Math.floor(ms/1000);
  const mm = Math.floor(totalSec/60).toString().padStart(2,'0');
  const ss = (totalSec%60).toString().padStart(2,'0');
  return `${mm}:${ss}`;
}

// Minutos jugados: cada jugadora en pista mientras el reloj corre acumula tiempo de partido (no tiempo real de reloj).
function ensureStatEntry(match, playerId){
  let s = match.stats.find(s=>s.playerId===playerId);
  if(!s){ s = {playerId}; match.stats.push(s); }
  if(s.segundosJugados === undefined) s.segundosJugados = 0;
  return s;
}
function addPlayedSeconds(match, playerId, seconds){
  if(seconds <= 0) return;
  const s = ensureStatEntry(match, playerId);
  s.segundosJugados = (s.segundosJugados||0) + seconds;
}
function startSession(match, playerId){
  if(!match.onCourtSince) match.onCourtSince = {};
  match.onCourtSince[playerId] = clockElapsedMs(match);
}
function endSession(match, playerId){
  if(!match.onCourtSince || match.onCourtSince[playerId] === undefined) return;
  const startElapsed = match.onCourtSince[playerId];
  const nowElapsed = clockElapsedMs(match);
  addPlayedSeconds(match, playerId, Math.round(Math.max(0, nowElapsed - startElapsed)/1000));
  delete match.onCourtSince[playerId];
}
// Segundos ya acumulados + los de la sesion en curso si el reloj esta corriendo ahora mismo (para mostrar en vivo)
function playerPlayedSeconds(match, playerId){
  const s = match.stats.find(s=>s.playerId===playerId);
  let total = s ? (s.segundosJugados||0) : 0;
  if(match.onCourtSince && match.onCourtSince[playerId] !== undefined){
    const startElapsed = match.onCourtSince[playerId];
    const nowElapsed = clockElapsedMs(match);
    total += Math.max(0, Math.round((nowElapsed - startElapsed)/1000));
  }
  return total;
}
// Minutos jugados con segundos exactos (m:ss), asi se ve que suma aunque sean pocos segundos
function fmtMinutes(seconds){
  const m = Math.floor(seconds/60);
  const s = Math.floor(seconds%60);
  return `${m}:${s.toString().padStart(2,'0')}`;
}

// ---- Exclusiones de 2 minutos en curso (puede haber varias a la vez) ----
const EXCLUSION_MS = 2 * 60 * 1000;

function exclusionRemainingMs(entry, match){
  const nowElapsed = clockElapsedMs(match);
  const elapsedSinceStart = nowElapsed - entry.startElapsedMs;
  return Math.max(0, EXCLUSION_MS - elapsedSinceStart);
}
function startExclusion(match, playerId){
  if(!match.activeExclusions) match.activeExclusions = [];
  match.activeExclusions.push({ playerId, startElapsedMs: clockElapsedMs(match) });
}
function cancelLastExclusion(match, playerId){
  if(!match.activeExclusions) return;
  for(let i = match.activeExclusions.length - 1; i >= 0; i--){
    if(match.activeExclusions[i].playerId === playerId){
      match.activeExclusions.splice(i, 1);
      return;
    }
  }
}
function isExcluded(match, playerId){
  return !!(match.activeExclusions && match.activeExclusions.some(e=>e.playerId===playerId));
}
// Como startSession, pero nunca arranca el contador de alguien que esté expulsada en ese momento
function startSessionIfAllowed(match, playerId){
  if(!isExcluded(match, playerId)) startSession(match, playerId);
}
function cleanupExpiredExclusions(match){
  if(!match.activeExclusions || match.activeExclusions.length===0) return false;
  const before = match.activeExclusions.length;
  const stillActive = match.activeExclusions.filter(e => exclusionRemainingMs(e, match) > 0);
  // jugadoras cuya exclusion acaba de cumplirse y ya no tienen ninguna otra activa
  const justFinishedIds = match.activeExclusions
    .filter(e => exclusionRemainingMs(e, match) <= 0)
    .map(e => e.playerId)
    .filter(pid => !stillActive.some(e => e.playerId === pid));
  match.activeExclusions = stillActive;
  if(getClock(match).running){
    justFinishedIds.forEach(pid=>{
      const alreadyCounting = match.onCourtSince && match.onCourtSince[pid] !== undefined;
      if(match.onCourt && match.onCourt.includes(pid) && !alreadyCounting){
        startSession(match, pid);
      }
    });
  }
  return match.activeExclusions.length !== before;
}

function stopRunningAndSettle(match){
  const c = getClock(match);
  if(!c.running) return;
  Object.keys(match.onCourtSince||{}).forEach(pid=> endSession(match, pid));
  c.elapsedMs = clockElapsedMs(match);
  c.running = false;
  c.startedAt = null;
}

function startClock(match){
  const c = getClock(match);
  if(c.running || c.elapsedMs >= MATCH_DURATION_MS) return;
  c.startedAt = Date.now();
  c.running = true;
  (match.onCourt||[]).forEach(pid=> startSessionIfAllowed(match, pid));
  saveState(); render();
}
function pauseClock(match){
  if(!getClock(match).running) return;
  stopRunningAndSettle(match);
  saveState(); render();
}
function resetClock(match){
  stopRunningAndSettle(match);
  const c = getClock(match);
  c.elapsedMs = 0;
  c.running = false;
  c.startedAt = null;
  match.onCourtSince = {};
  saveState(); render();
}
function adjustClock(match, deltaMs){
  const c = getClock(match);
  if(c.running){
    let newStart = c.startedAt - deltaMs;
    if(newStart > Date.now()) newStart = Date.now();
    c.startedAt = newStart;
  } else {
    c.elapsedMs = Math.max(0, Math.min(MATCH_DURATION_MS, c.elapsedMs + deltaMs));
  }
  saveState(); render();
}
function takeTimeout(match){
  const c = getClock(match);
  c.timeoutsUsed = (c.timeoutsUsed||0) + 1;
  stopRunningAndSettle(match);
  saveState(); render();
}
const MAX_ON_COURT = 7;
let pendingSubIn = null; // id de la jugadora del banquillo esperando a que elijas a quién saca

function addToCourt(match, playerId){
  if(!match.onCourt) match.onCourt = [];
  match.onCourt.push(playerId);
  if(getClock(match).running) startSessionIfAllowed(match, playerId);
  saveState(); render();
}

// Se llama al tocar una ficha del banquillo: si hay hueco entra directa; si la pista está
// completa, entra en modo "elige a quién sacar" en vez de bloquear con un aviso.
function benchTileClicked(match, playerId){
  if(!match.onCourt) match.onCourt = [];
  if(match.onCourt.length < MAX_ON_COURT){
    addToCourt(match, playerId);
  } else {
    pendingSubIn = (pendingSubIn === playerId) ? null : playerId;
    render();
  }
}

// Se llama al tocar una ficha en pista mientras hay una sustitución pendiente: la que estaba
// sale, la del banquillo entra en su lugar.
function performSubstitution(match, outPlayerId, inPlayerId){
  const idx = match.onCourt.indexOf(outPlayerId);
  const c = getClock(match);
  if(idx >= 0){
    if(c.running) endSession(match, outPlayerId);
    match.onCourt.splice(idx, 1);
  }
  if(!match.onCourt.includes(inPlayerId)){
    match.onCourt.push(inPlayerId);
    if(c.running) startSessionIfAllowed(match, inPlayerId);
  }
  pendingSubIn = null;
  saveState(); render();
}

// ---- Ataque / Defensa: dos alineaciones guardadas que se intercambian de un toque ----
function saveLineup(match, phase){
  if(!match.lineups) match.lineups = {};
  match.lineups[phase] = [...match.onCourt];
  match.currentPhase = phase;
  saveState(); render();
  showToast(`Alineación de ${phase==='ataque'?'Ataque':'Defensa'} guardada (${match.onCourt.length} jugadoras).`);
}

function applyLineup(match, phase, validIds){
  const saved = match.lineups && match.lineups[phase];
  if(!saved){
    // todavia no hay nada guardado para esta fase: solo marcamos cual esta activa
    match.currentPhase = phase;
    saveState(); render();
    return;
  }
  const c = getClock(match);
  const targetSet = new Set(saved.filter(id => validIds.has(id)));
  const currentSet = new Set(match.onCourt);
  match.onCourt.forEach(pid=>{
    if(!targetSet.has(pid) && c.running) endSession(match, pid);
  });
  targetSet.forEach(pid=>{
    if(!currentSet.has(pid) && c.running) startSessionIfAllowed(match, pid);
  });
  match.onCourt = Array.from(targetSet);
  match.currentPhase = phase;
  saveState(); render();
}

function openNewMatchModal(){
  if(playersOfCategory(activeCategory).length===0){
    showToast('Añade jugadores a esta categoría primero');
    return;
  }
  modal = {type:'newMatch', data:{date:new Date().toISOString().slice(0,10), rival:'', venue:'Local', tipo:'Liga'}};
  render();
}

function finishMatch(match){
  stopRunningAndSettle(match);
  match.finalizado = true; // deja de aparecer en Pista y no se puede volver a seleccionar ahí
  saveState();
  const rival = match.rival;
  const categoria = match.categoria;
  pistaMatchId = null; // resetea Pista para dejarlo listo para el siguiente partido
  modal = {
    type:'info',
    data:{
      title:'✅ Partido guardado',
      message:`Tu partido contra "${escapeHtml(rival)}" se ha guardado correctamente en "${escapeHtml(categoria)}". Lo encontrarás en la pestaña Partidos.`
    }
  };
  render();
}
