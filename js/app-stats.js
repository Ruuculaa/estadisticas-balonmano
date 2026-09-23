// app-stats.js: cálculo de estadísticas de temporada/partido y el render() principal

function computeSeasonTotals(player, category){
  const matches = matchesOfCategory(category);
  const fields = getStatFields(player);
  const totals = {};
  fields.forEach(f=> totals[f.key]=0);
  let matchesPlayed = 0, totalGoles = 0, totalParadas = 0, totalSanciones = 0, totalSegundos = 0;
  matches.forEach(m=>{
    const s = m.stats.find(s=>s.playerId===player.id);
    if(s){
      fields.forEach(f=> totals[f.key] += (s[f.key]||0));
      totalGoles += GOAL_KEYS.reduce((a,k)=>a+(s[k]||0),0);
      totalParadas += SAVE_KEYS.reduce((a,k)=>a+(s[k]||0),0);
      totalSanciones += SANCTION_KEYS.reduce((a,k)=>a+(s[k]||0),0);
      totalSegundos += (s.segundosJugados||0);
      if(ALL_STAT_FIELDS.some(f=>(s[f.key]||0)>0)) matchesPlayed++;
    }
  });
  return {totals, matchesPlayed, totalGoles, totalParadas, totalSanciones, totalSegundos};
}

function playersOfCategory(cat){ return state.players.filter(p=>p.categoria===cat); }
function matchesOfCategory(cat){ return state.matches.filter(m=>m.categoria===cat); }

function ensureMatchStats(match){
  playersOfCategory(match.categoria).forEach(p=>{
    if(!match.stats.find(s=>s.playerId===p.id)){
      const s = {playerId:p.id};
      getStatFields(p).forEach(f=>s[f.key]=0);
      match.stats.push(s);
    }
  });
}

function getStat(match, playerId, key){
  const s = match.stats.find(s=>s.playerId===playerId);
  return s ? (s[key]||0) : 0;
}
function playerGoals(match, playerId){
  const s = match.stats.find(s=>s.playerId===playerId);
  if(!s) return 0;
  return GOAL_KEYS.reduce((sum,k)=> sum + (s[k]||0), 0);
}
function playerSaves(match, playerId){
  const s = match.stats.find(s=>s.playerId===playerId);
  if(!s) return 0;
  return SAVE_KEYS.reduce((sum,k)=> sum + (s[k]||0), 0);
}
function playerSanctions(match, playerId){
  const s = match.stats.find(s=>s.playerId===playerId);
  if(!s) return 0;
  return SANCTION_KEYS.reduce((sum,k)=> sum + (s[k]||0), 0);
}
// Elige que numero/etiqueta destacar segun el rol: entrenador -> sanciones, portera -> paradas, resto -> goles
function statHeadline(p, values){
  if(p.role === 'entrenador') return {value: values.sanciones, label:'sanciones'};
  if(p.position === 'Portero') return {value: values.paradas, label:'paradas'};
  return {value: values.goles, label:'goles'};
}
function matchGoalsFavor(match){
  return match.stats.reduce((sum,s)=> sum + GOAL_KEYS.reduce((a,k)=>a+(s[k]||0),0), 0);
}
function bumpStat(matchId, playerId, key, delta){
  const match = state.matches.find(m=>m.id===matchId);
  let s = match.stats.find(s=>s.playerId===playerId);
  if(!s){
    const player = state.players.find(x=>x.id===playerId);
    s = {playerId};
    getStatFields(player).forEach(f=>s[f.key]=0);
    match.stats.push(s);
  }
  s[key] = Math.max(0, (s[key]||0) + delta);
  if(GOAL_KEYS.includes(key)){
    if(!match.goalLog) match.goalLog = [];
    match.goalLog.push({ playerId, statKey: key, delta, elapsedMs: clockElapsedMs(match), ts: Date.now() });
  }
  if(key === 'exclusiones'){
    if(delta > 0){
      startExclusion(match, playerId);
      // pausa el contador de minutos mientras esta expulsada: no cuenta como si jugara
      if(match.onCourt && match.onCourt.includes(playerId) && getClock(match).running){
        endSession(match, playerId);
      }
    } else if(delta < 0){
      cancelLastExclusion(match, playerId);
      const stillExcluded = match.activeExclusions && match.activeExclusions.some(e=>e.playerId===playerId);
      const alreadyCounting = match.onCourtSince && match.onCourtSince[playerId] !== undefined;
      if(!stillExcluded && !alreadyCounting && match.onCourt && match.onCourt.includes(playerId) && getClock(match).running){
        startSession(match, playerId);
      }
    }
  }
  saveState();
  render();
}

function lastGoalEntry(match){
  if(!match.goalLog || match.goalLog.length===0) return null;
  return match.goalLog[match.goalLog.length-1];
}
function goalLogRowText(entry, rosterAll){
  const p = rosterAll.find(x=>x.id===entry.playerId);
  const name = p ? p.name : 'jugadora eliminada';
  const num = p ? (p.number ?? '') : '';
  const label = GOAL_LABELS[entry.statKey] || entry.statKey;
  return { name, num, label, time: fmtClock(entry.elapsedMs), isCorrection: entry.delta < 0 };
}

function resultTag(m){
  const gf = matchGoalsFavor(m);
  if(gf===m.golesContra) return {c:'tag-draw', t:'Empate'};
  return gf>m.golesContra ? {c:'tag-win', t:'Victoria'} : {c:'tag-loss', t:'Derrota'};
}

function fmtDate(d){
  if(!d) return '';
  const [y,m,day] = d.split('-');
  return `${day}/${m}/${y}`;
}

function applyTheme(){
  document.documentElement.setAttribute('data-theme', theme);
}

function themeIcon(){
  if(theme==='dark'){
    return '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 12.6A9 9 0 1 1 11.4 3a7 7 0 0 0 9.6 9.6z"/></svg>';
  }
  return '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="4.5"/><path d="M12 3v2M12 19v2M4.2 4.2l1.4 1.4M18.4 18.4l1.4 1.4M3 12h2M19 12h2M4.2 19.8l1.4-1.4M18.4 5.6l1.4-1.4"/></svg>';
}

function icon(name){
  const icons = {
    partidos: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="9"/><path d="M12 3v18M3 12h18M6 6l4 3M18 6l-4 3M6 18l4-3M18 18l-4-3"/></svg>',
    jugadores: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="9" cy="8" r="3.2"/><path d="M3 20c0-3.5 2.7-6 6-6s6 2.5 6 6"/><circle cx="17" cy="7" r="2.6"/><path d="M15.5 14c2.6.3 4.5 2.5 4.5 6"/></svg>',
    resumen: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M4 20V10M12 20V4M20 20v-7"/></svg>',
    pista: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="9"/><path d="M12 7v5l3.5 2"/></svg>',
  };
  return icons[name] || '';
}

// ---------- RENDER ----------
function renderApp(){
  const app = document.getElementById('app');
  app.innerHTML = '';

  const header = document.createElement('div');
  header.className = 'header';
  const catPlayers = playersOfCategory(activeCategory).length;
  const catMatches = matchesOfCategory(activeCategory).length;
  header.innerHTML = `
    <div class="header-top">
      ${currentClub && currentClub.logo ? `<img src="${currentClub.logo}" class="header-club-logo" alt="">` : ''}
      <h1 class="team-name">${escapeHtml(TEAM_NAME)}</h1>
      <button class="team-edit-btn" id="club-btn" title="Tu club">👥</button>
      <button class="theme-toggle" id="theme-toggle" title="Cambiar tema" aria-label="Cambiar tema claro/oscuro">${themeIcon()}</button>
    </div>
    <div class="sub">${activeCategory} · ${catMatches} partido${catMatches===1?'':'s'} · ${catPlayers} jugador${catPlayers===1?'':'es'}</div>
    <div class="cat-row">
      <button class="cat-arrow" id="cat-prev">‹</button>
      <div class="cat-scroll" id="cat-scroll">
        ${CATEGORIES.map(c=>`<button class="cat-pill${c===activeCategory?' active':''}" data-c="${escapeAttr(c)}">${c}</button>`).join('')}
      </div>
      <button class="cat-arrow" id="cat-next">›</button>
    </div>
  `;
  header.querySelector('#club-btn').addEventListener('click', ()=>{
    modal = {type:'clubPanel', data:{}};
    render();
  });
  header.querySelectorAll('.cat-pill').forEach(b=>{
    b.addEventListener('click', ()=>{
      if(b.dataset.c === activeCategory) return;
      activeCategory = b.dataset.c;
      openMatchId = null;
      pistaMatchId = null;
      mainScrollTop = 0;
      pendingSubIn = null;
      loadCategory(activeCategory);
      centerCategoryPill(activeCategory);
    });
  });
  header.querySelector('#theme-toggle').addEventListener('click', ()=>{
    theme = theme==='dark' ? 'light' : 'dark';
    applyTheme();
    persistTheme();
    render();
  });
  const scroller = header.querySelector('#cat-scroll');
  header.querySelector('#cat-prev').addEventListener('click', ()=>{
    scroller.scrollBy({left:-130, behavior:'auto'});
  });
  header.querySelector('#cat-next').addEventListener('click', ()=>{
    scroller.scrollBy({left:130, behavior:'auto'});
  });
  app.appendChild(header);
  scroller.scrollLeft = catScrollLeft; // restaura la posición (ya insertado en el documento, con tamaño real)
  scroller.addEventListener('scroll', ()=>{ catScrollLeft = scroller.scrollLeft; });

  const main = document.createElement('main');
  if(view==='pista') main.classList.add('main-pista');
  app.appendChild(main); // insertado antes de rellenarlo, para que los scroll internos tengan tamaño real
  try{
    if(view==='partidos'){
      if(openMatchId){
        renderMatchDetail(main);
      } else {
        renderMatches(main);
      }
    } else if(view==='jugadores'){
      renderPlayers(main);
    } else if(view==='resumen'){
      renderResumen(main);
    } else if(view==='pista'){
      renderPista(main);
    }
  }catch(e){
    main.innerHTML = '';
    const err = document.createElement('div');
    err.className = 'empty';
    err.innerHTML = 'Ha ocurrido un error al mostrar esta pantalla.<br><br><button class="btn btn-accent" id="err-retry">Reintentar</button>';
    main.appendChild(err);
    const retryBtn = err.querySelector('#err-retry');
    if(retryBtn) retryBtn.addEventListener('click', ()=>{ openMatchId=null; pistaMatchId=null; render(); });
    console.error('Error al renderizar', view, e);
  }

  if(!openMatchId){
    const bottomBar = document.createElement('div');
    bottomBar.className = 'bottom-bar';
    const nav = document.createElement('div');
    nav.className = 'bottom-nav';
    ['partidos','jugadores','pista','resumen'].forEach(v=>{
      const b = document.createElement('button');
      b.className = 'nav-btn' + (view===v?' active':'');
      const labels = {partidos:'Partidos', jugadores:'Jugadores', pista:'Pista', resumen:'Resumen'};
      b.innerHTML = icon(v) + `<span>${labels[v]}</span>`;
      b.addEventListener('click', ()=>{ view=v; mainScrollTop=0; render(); });
      nav.appendChild(b);
    });
    bottomBar.appendChild(nav);
    const credit = document.createElement('div');
    credit.className = 'credit-line';
    credit.innerHTML = 'Hecho por Andrea Garreta · <a href="https://rgwebstudio.net/" target="_blank" rel="noopener">rgwebstudio.net</a>';
    bottomBar.appendChild(credit);
    app.appendChild(bottomBar);
  }

  main.scrollTop = mainScrollTop; // restaura la posición: evita que el scroll vuelva arriba en cada repintado (p.ej. cada segundo con el cronómetro)
  main.addEventListener('scroll', ()=>{ mainScrollTop = main.scrollTop; });

  if(modal){ renderModal(app); }
}

function centerCategoryPill(categoryName){
  const scroller = document.getElementById('cat-scroll');
  if(!scroller) return;
  const btn = Array.from(scroller.querySelectorAll('.cat-pill')).find(el => el.dataset.c === categoryName);
  if(!btn) return;
  const target = Math.max(0, btn.offsetLeft - scroller.clientWidth/2 + btn.clientWidth/2);
  scroller.scrollTo({left: target, behavior:'auto'});
  catScrollLeft = target;
}

function escapeAttr(s){ return (s||'').replace(/"/g,'&quot;'); }
function escapeHtml(s){ return (s||'').replace(/[&<>"]/g, c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c])); }