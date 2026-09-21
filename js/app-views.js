// app-views.js: pantallas (Partidos, Jugadores, Resumen, Pista), modales y arranque

function renderPista(main){
  const match = matchesOfCategory(activeCategory).find(m => !m.finalizado);

  if(!match){
    const btnRow = document.createElement('div');
    btnRow.className = 'fab-row';
    btnRow.innerHTML = `<button class="btn btn-accent btn-block">+ Crear partido</button>`;
    btnRow.querySelector('button').addEventListener('click', openNewMatchModal);
    main.appendChild(btnRow);
    const e = document.createElement('div');
    e.className = 'empty';
    e.textContent = `Crea un partido en ${activeCategory} para empezar a llevar el cronómetro y el minutaje. Los partidos ya guardados se consultan desde Partidos.`;
    main.appendChild(e);
    return;
  }

  if(!match.onCourt) match.onCourt = [];
  pistaMatchId = match.id;

  // Marcador compacto (el único sitio donde ya se puede tocar el gol del rival)
  const gf = matchGoalsFavor(match);
  const scoreBox = document.createElement('div');
  scoreBox.className = 'pista-score';
  scoreBox.innerHTML = `
    <div class="pista-score-sub">${fmtDate(match.date)} · ${match.venue} · ${match.tipo || 'Liga'}</div>
    <div class="pista-score-row">
      <div class="pista-score-team">
        <div class="pista-score-num">${gf}</div>
        <div class="pista-score-label">${TEAM_NAME}</div>
      </div>
      <div class="pista-score-sep">–</div>
      <div class="pista-score-team">
        <div class="pista-score-num">${match.golesContra}</div>
        <div class="pista-score-label">
          ${escapeHtml(match.rival)}
          <button class="rival-edit-btn" id="rival-edit-btn" title="Corregir el nombre del rival">✎</button>
        </div>
      </div>
    </div>
    <div class="pista-score-steppers">
      <button id="riv-minus" class="btn btn-ghost btn-small">− Gol rival</button>
      <button id="riv-plus" class="btn btn-ghost btn-small">+ Gol rival</button>
    </div>
  `;
  scoreBox.querySelector('#rival-edit-btn').addEventListener('click', ()=>{
    modal = {type:'editRivalName', data:{matchId: match.id, name: match.rival}};
    render();
  });
  scoreBox.querySelector('#riv-minus').addEventListener('click', ()=>{
    match.golesContra = Math.max(0, match.golesContra-1);
    saveState(); render();
  });
  scoreBox.querySelector('#riv-plus').addEventListener('click', ()=>{
    match.golesContra = match.golesContra+1;
    saveState(); render();
  });
  main.appendChild(scoreBox);

  // Ultimo gol anotado (o corregido), para poder comprobar el marcador con el rival
  const rosterForLog = playersOfCategory(match.categoria);
  const lastEntry = lastGoalEntry(match);
  const goalLogBox = document.createElement('div');
  goalLogBox.className = 'goal-log-summary';
  if(lastEntry){
    const row = goalLogRowText(lastEntry, rosterForLog);
    goalLogBox.innerHTML = `
      <span>${row.isCorrection ? 'Última corrección: ' : 'Último gol: '}<b>#${row.num} ${escapeHtml(row.name)}</b> · ${row.label} · ${row.time}</span>
      <button class="btn btn-ghost btn-small" id="goal-history-btn">Ver historial</button>
    `;
  } else {
    goalLogBox.innerHTML = `
      <span>Todavía no hay goles anotados</span>
      <button class="btn btn-ghost btn-small" id="goal-history-btn">Ver historial</button>
    `;
  }
  goalLogBox.querySelector('#goal-history-btn').addEventListener('click', ()=>{
    modal = {type:'goalHistory', data:{matchId: match.id}};
    render();
  });
  main.appendChild(goalLogBox);

  // Exclusiones de 2 minutos en curso (cuenta atrás ligada al reloj del partido)
  if(match.activeExclusions && match.activeExclusions.length){
    const activePlayers = playersOfCategory(match.categoria);
    const excRow = document.createElement('div');
    excRow.className = 'cards-row exclusion-row';
    excRow.innerHTML = match.activeExclusions.map(entry=>{
      const p = activePlayers.find(x=>x.id===entry.playerId);
      const label = p ? (p.role==='entrenador' ? 'E' : (p.number ?? '')) : '?';
      const remaining = exclusionRemainingMs(entry, match);
      return `
        <div class="card-chip exclusion-chip" title="${p ? escapeAttr(p.name) : ''}">
          <span class="card-chip-num">#${label}</span>
          <span class="exclusion-time">${fmtClock(remaining)}</span>
        </div>
      `;
    }).join('');
    main.appendChild(excRow);
  }

  // Tarjetas (amarilla/roja) de cualquiera, jugadoras o cuerpo técnico
  const rosterAll = playersOfCategory(match.categoria);
  const cards = [];
  rosterAll.forEach(p=>{
    const s = match.stats.find(s=>s.playerId===p.id);
    if(!s) return;
    const label = p.role === 'entrenador' ? 'E' : (p.number ?? '');
    if((s.amarillas||0) > 0) cards.push({label, name:p.name, type:'amarilla', count:s.amarillas});
    if((s.rojas||0) > 0) cards.push({label, name:p.name, type:'roja', count:s.rojas});
  });
  if(cards.length){
    const cardsRow = document.createElement('div');
    cardsRow.className = 'cards-row';
    cardsRow.innerHTML = cards.map(c=>`
      <div class="card-chip" title="${escapeAttr(c.name)}">
        <span class="card-chip-num">#${c.label}</span>
        <span class="card-chip-square card-chip-${c.type}"></span>
        ${c.count > 1 ? `<span class="card-chip-count">×${c.count}</span>` : ''}
      </div>
    `).join('');
    main.appendChild(cardsRow);
  }

  // Jugadoras en pista: tocar la ficha abre sus estadisticas; la "✕" la manda al banquillo
  const players = sortRoster(playersOfCategory(match.categoria).filter(p=>p.role!=='entrenador'));
  const onCourt = players.filter(p=> match.onCourt.includes(p.id));
  const bench = players.filter(p=> !match.onCourt.includes(p.id));
  const coaches = sortRoster(rosterAll.filter(p=>p.role==='entrenador'));

  const courtTitle = document.createElement('div');
  courtTitle.className = 'pista-section-title';
  courtTitle.textContent = `En pista (${onCourt.length}/${MAX_ON_COURT}) · toca para apuntar`;
  main.appendChild(courtTitle);

  if(pendingSubIn){
    const pendingPlayer = players.find(x=>x.id===pendingSubIn);
    if(!pendingPlayer){
      pendingSubIn = null;
    } else {
      const banner = document.createElement('div');
      banner.className = 'sub-banner';
      banner.innerHTML = `
        <span>Elige a quién saca <b>#${pendingPlayer.number ?? ''} ${escapeHtml(pendingPlayer.name)}</b></span>
        <button class="btn btn-ghost btn-small" id="sub-cancel">Cancelar</button>
      `;
      banner.querySelector('#sub-cancel').addEventListener('click', ()=>{ pendingSubIn = null; render(); });
      main.appendChild(banner);
    }
  }

  const courtGrid = document.createElement('div');
  courtGrid.className = 'player-grid';
  if(onCourt.length===0){
    const e = document.createElement('div');
    e.className = 'empty';
    e.textContent = 'Toca jugadoras del banquillo para sacarlas a pista.';
    courtGrid.appendChild(e);
  } else {
    onCourt.forEach(p=>{
      const headline = statHeadline(p, {
        goles: playerGoals(match, p.id),
        paradas: playerSaves(match, p.id),
        sanciones: playerSanctions(match, p.id),
      });
      const tile = document.createElement('div');
      const excluded = isExcluded(match, p.id);
      tile.className = 'player-tile on-court-tile' + (pendingSubIn ? ' sub-target' : '') + (excluded ? ' tile-excluded' : '');
      tile.innerHTML = `
        <div class="tile-num">${p.number ?? ''}</div>
        <div class="tile-name">${escapeHtml(p.name)}</div>
        <div class="tile-goals">${headline.value}</div>
        <div class="tile-mins">${fmtMinutes(playerPlayedSeconds(match, p.id))}</div>
      `;
      tile.addEventListener('click', ()=>{
        if(pendingSubIn){
          performSubstitution(match, p.id, pendingSubIn);
        } else {
          modal = {type:'playerStats', data:{matchId: match.id, playerId: p.id}};
          render();
        }
      });
      courtGrid.appendChild(tile);
    });
  }
  main.appendChild(courtGrid);

  // Ataque / Defensa: dos alineaciones guardadas que se intercambian de un toque
  if(!match.lineups) match.lineups = {};
  const validIds = new Set(players.map(p=>p.id));
  const phaseRow = document.createElement('div');
  phaseRow.className = 'segmented phase-seg';
  phaseRow.innerHTML = `
    <button type="button" data-p="ataque" class="${match.currentPhase==='ataque'?'active':''}">🟢 Ataque${match.lineups.ataque?'':' (sin guardar)'}</button>
    <button type="button" data-p="defensa" class="${match.currentPhase==='defensa'?'active':''}">🔴 Defensa${match.lineups.defensa?'':' (sin guardar)'}</button>
  `;
  phaseRow.querySelectorAll('button').forEach(b=>{
    b.addEventListener('click', ()=> applyLineup(match, b.dataset.p, validIds));
  });
  main.appendChild(phaseRow);

  const activePhase = match.currentPhase === 'defensa' ? 'defensa' : 'ataque';
  const saveLineupRow = document.createElement('div');
  saveLineupRow.style.marginBottom = '16px';
  saveLineupRow.innerHTML = `<button class="btn btn-ghost btn-block btn-small">💾 Guardar alineación actual como ${activePhase==='defensa'?'Defensa':'Ataque'}</button>`;
  saveLineupRow.querySelector('button').addEventListener('click', ()=> saveLineup(match, activePhase));
  main.appendChild(saveLineupRow);

  // Cronometro, compacto, en medio
  const clock = getClock(match);
  const elapsed = clockElapsedMs(match);
  const elapsedSec = Math.floor(elapsed/1000);
  const isFinished = elapsedSec >= MATCH_DURATION_MS/1000;
  const clockBox = document.createElement('div');
  clockBox.className = 'clock-box clock-box-compact';
  clockBox.innerHTML = `
    <div class="clock-time${isFinished?' clock-time-zero':''}">${fmtClock(elapsed)}</div>
    <div class="clock-adjust-row">
      <button id="clk-minus" class="btn btn-ghost btn-small">−1 min</button>
      <button id="clk-toggle" class="btn ${clock.running?'btn-danger-solid':'btn-accent'}" ${isFinished?'disabled':''}>${clock.running ? '❚❚ Pausar' : '▶ Iniciar'}</button>
      <button id="clk-plus" class="btn btn-ghost btn-small">+1 min</button>
    </div>
    <div class="clock-sub-row">
      <button id="clk-timeout" class="btn btn-ghost btn-small">Tiempo muerto (${clock.timeoutsUsed||0})</button>
      <button id="clk-reset" class="btn btn-ghost btn-small">Reiniciar</button>
    </div>
    ${isFinished ? '<button id="clk-save" class="btn btn-accent btn-block" style="margin-top:10px;">💾 Guardar partido</button>' : ''}
  `;
  clockBox.querySelector('#clk-toggle').addEventListener('click', ()=>{
    clock.running ? pauseClock(match) : startClock(match);
  });
  clockBox.querySelector('#clk-minus').addEventListener('click', ()=> adjustClock(match, -60000));
  clockBox.querySelector('#clk-plus').addEventListener('click', ()=> adjustClock(match, 60000));
  clockBox.querySelector('#clk-timeout').addEventListener('click', ()=> takeTimeout(match));
  clockBox.querySelector('#clk-reset').addEventListener('click', ()=>{
    showConfirm('¿Reiniciar el cronómetro a 00:00?', ()=> resetClock(match));
  });
  const saveBtn = clockBox.querySelector('#clk-save');
  if(saveBtn){
    saveBtn.addEventListener('click', ()=> finishMatch(match));
  }
  main.appendChild(clockBox);

  // Banquillo
  const benchTitle = document.createElement('div');
  benchTitle.className = 'pista-section-title';
  benchTitle.textContent = `Banquillo (${bench.length})`;
  main.appendChild(benchTitle);

  const benchGrid = document.createElement('div');
  benchGrid.className = 'player-grid';
  if(bench.length===0){
    const e = document.createElement('div');
    e.className = 'empty';
    e.textContent = 'Toda la plantilla está en pista.';
    benchGrid.appendChild(e);
  } else {
    bench.forEach(p=>{
      const secs = playerPlayedSeconds(match, p.id);
      const tile = document.createElement('div');
      tile.className = 'player-tile' + (pendingSubIn===p.id ? ' sub-pending' : '') + (isExcluded(match, p.id) ? ' tile-excluded' : '');
      tile.innerHTML = `
        <div class="tile-num">${p.number ?? ''}</div>
        <div class="tile-name">${escapeHtml(p.name)}</div>
        ${secs > 0 ? `<div class="tile-goals">${fmtMinutes(secs)}</div>` : ''}
      `;
      tile.addEventListener('click', ()=> benchTileClicked(match, p.id));
      benchGrid.appendChild(tile);
    });
  }
  main.appendChild(benchGrid);

  // Cuerpo tecnico: no juega en pista, pero tambien puede recibir tarjetas
  if(coaches.length){
    const coachTitle = document.createElement('div');
    coachTitle.className = 'pista-section-title';
    coachTitle.style.marginTop = '18px';
    coachTitle.textContent = 'Cuerpo técnico · toca para apuntar';
    main.appendChild(coachTitle);

    const coachGrid = document.createElement('div');
    coachGrid.className = 'player-grid';
    coaches.forEach(p=>{
      const headline = statHeadline(p, {goles:0, paradas:0, sanciones: playerSanctions(match, p.id)});
      const tile = document.createElement('div');
      tile.className = 'player-tile is-coach' + (isExcluded(match, p.id) ? ' tile-excluded' : '');
      tile.innerHTML = `
        <div class="tile-num is-coach">E</div>
        <div class="tile-name">${escapeHtml(p.name)}</div>
        <div class="tile-goals">${headline.value}</div>
      `;
      tile.addEventListener('click', ()=>{
        modal = {type:'playerStats', data:{matchId: match.id, playerId: p.id}};
        render();
      });
      coachGrid.appendChild(tile);
    });
    main.appendChild(coachGrid);
  }
}

// ---- Partidos list ----
function renderMatches(main){
  const matches = matchesOfCategory(activeCategory);
  if(matches.length===0){
    const e = document.createElement('div');
    e.className = 'empty';
    e.textContent = `Todavía no hay partidos en ${activeCategory}. Ve a la pestaña Pista para crear el primero.`;
    main.appendChild(e);
    return;
  }

  const sorted = [...matches].sort((a,b)=> b.date.localeCompare(a.date));
  const grid = document.createElement('div');
  grid.className = 'card-grid';
  sorted.forEach(m=>{
    const tag = resultTag(m);
    const gf = matchGoalsFavor(m);
    const card = document.createElement('div');
    card.className = 'card match-row';
    card.innerHTML = `
      <div>
        <div class="date">${fmtDate(m.date)} · ${m.venue}</div>
        <div class="rival">vs ${escapeHtml(m.rival)}</div>
        <span class="result-tag ${tag.c}">${tag.t}</span>
        <span class="result-tag tag-type">${m.tipo || 'Liga'}</span>
      </div>
      <div class="score">${gf}<span class="sep">–</span>${m.golesContra}</div>
    `;
    card.addEventListener('click', ()=>{ openMatchId = m.id; mainScrollTop = 0; render(); });
    grid.appendChild(card);
  });
  main.appendChild(grid);
}

// Textos con género para el Excel: masculino por defecto, femenino solo en Senior Femenino.
function roleLabelExport(isCoach, category){
  const fem = category === 'Senior Femenino';
  if(isCoach) return fem ? 'Entrenadora' : 'Entrenador';
  return fem ? 'Jugadora' : 'Jugador';
}
function positionLabelExport(position, category){
  const fem = category === 'Senior Femenino';
  if(position === 'Portero') return fem ? 'Portera' : 'Portero';
  if(position === 'Entrenador/a') return fem ? 'Entrenadora' : 'Entrenador';
  return position; // el resto de posiciones (Central, Pivote, Lateral, Extremo) no cambian de forma
}

function exportMatchExcel(match){
  if(typeof XLSX === 'undefined'){
    showToast('No se pudo cargar el generador de Excel. Revisa tu conexión.');
    return;
  }
  const roster = playersOfCategory(match.categoria);
  const gf = matchGoalsFavor(match);

  const infoRows = [
    ['Club', TEAM_NAME],
    ['Categoría', match.categoria],
    ['Rival', match.rival],
    ['Fecha', fmtDate(match.date)],
    ['Sede', match.venue],
    ['Tipo', match.tipo || 'Liga'],
    ['Resultado', `${gf} - ${match.golesContra}`],
  ];
  const wsInfo = XLSX.utils.aoa_to_sheet(infoRows);
  wsInfo['!cols'] = [{wch:14},{wch:28}];

  const headers = ['Dorsal','Rol','Nombre','Posición', ...ALL_STAT_FIELDS.map(f=>f.label), 'Goles totales', 'Paradas totales', 'Sanciones totales', 'Minutos jugados'];
  const rows = sortRoster(roster).map(p=>{
    const isCoach = p.role === 'entrenador';
    const row = [isCoach ? '' : p.number, roleLabelExport(isCoach, match.categoria), p.name, positionLabelExport(p.position, match.categoria)];
    ALL_STAT_FIELDS.forEach(f=> row.push(getStat(match, p.id, f.key)));
    row.push(playerGoals(match, p.id));
    row.push(playerSaves(match, p.id));
    row.push(playerSanctions(match, p.id));
    row.push(isCoach ? '' : Math.floor(playerPlayedSeconds(match, p.id)/60));
    return row;
  });
  const wsPlayers = XLSX.utils.aoa_to_sheet([headers, ...rows]);
  wsPlayers['!cols'] = [{wch:8},{wch:12},{wch:24},{wch:14}, ...ALL_STAT_FIELDS.map(()=>({wch:9})), {wch:13},{wch:13},{wch:13},{wch:15}];

  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, wsInfo, 'Partido');
  XLSX.utils.book_append_sheet(wb, wsPlayers, 'Jugadoras');

  const safeRival = (match.rival || 'Rival').replace(/[^a-zA-Z0-9]+/g, '_');
  const filename = `${TEAM_NAME}_vs_${safeRival}_${match.date}.xlsx`;
  XLSX.writeFile(wb, filename);
}

function exportSeasonExcel(category){
  if(typeof XLSX === 'undefined'){
    showToast('No se pudo cargar el generador de Excel. Revisa tu conexión.');
    return;
  }
  const matches = [...matchesOfCategory(category)].sort((a,b)=> a.date.localeCompare(b.date));
  const players = sortRoster(playersOfCategory(category));

  // Hoja 1: resumen del equipo
  let w=0, d=0, l=0, gf=0, gc=0;
  matches.forEach(m=>{
    const favor = matchGoalsFavor(m);
    gf += favor; gc += m.golesContra;
    if(favor > m.golesContra) w++;
    else if(favor < m.golesContra) l++;
    else d++;
  });
  const infoRows = [
    ['Club', TEAM_NAME],
    ['Categoría', category],
    ['Partidos jugados', matches.length],
    ['Ganados', w],
    ['Empatados', d],
    ['Perdidos', l],
    ['Goles a favor', gf],
    ['Goles en contra', gc],
  ];
  const wsInfo = XLSX.utils.aoa_to_sheet(infoRows);
  wsInfo['!cols'] = [{wch:18},{wch:22}];

  // Hoja 2: todos los partidos de la temporada
  const matchHeaders = ['Fecha','Rival','Sede','Tipo','Goles favor','Goles contra','Resultado'];
  const matchRows = matches.map(m=>{
    const favor = matchGoalsFavor(m);
    const tag = resultTag(m);
    return [fmtDate(m.date), m.rival, m.venue, m.tipo || 'Liga', favor, m.golesContra, tag.t];
  });
  const wsMatches = XLSX.utils.aoa_to_sheet([matchHeaders, ...matchRows]);
  wsMatches['!cols'] = [{wch:12},{wch:24},{wch:12},{wch:11},{wch:12},{wch:13},{wch:11}];

  // Hoja 3: acumulado de cada jugadora/entrenador en toda la temporada
  const playerHeaders = ['Dorsal','Rol','Nombre','Posición','Partidos jugados', ...ALL_STAT_FIELDS.map(f=>f.label), 'Goles totales','Paradas totales','Sanciones totales','Minutos jugados'];
  const playerRows = players.map(p=>{
    const isCoach = p.role === 'entrenador';
    const {totals, matchesPlayed, totalGoles, totalParadas, totalSanciones, totalSegundos} = computeSeasonTotals(p, category);
    const row = [isCoach ? '' : p.number, roleLabelExport(isCoach, category), p.name, positionLabelExport(p.position, category), matchesPlayed];
    ALL_STAT_FIELDS.forEach(f=> row.push(totals[f.key] !== undefined ? totals[f.key] : 0));
    row.push(totalGoles);
    row.push(totalParadas);
    row.push(totalSanciones);
    row.push(isCoach ? '' : Math.floor(totalSegundos/60));
    return row;
  });
  const wsPlayers = XLSX.utils.aoa_to_sheet([playerHeaders, ...playerRows]);
  wsPlayers['!cols'] = [{wch:8},{wch:12},{wch:24},{wch:14},{wch:10}, ...ALL_STAT_FIELDS.map(()=>({wch:9})), {wch:13},{wch:13},{wch:13},{wch:15}];

  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, wsInfo, 'Resumen');
  XLSX.utils.book_append_sheet(wb, wsMatches, 'Partidos');
  XLSX.utils.book_append_sheet(wb, wsPlayers, 'Jugadoras');

  const safeCat = category.replace(/[^a-zA-Z0-9]+/g, '_');
  const filename = `${TEAM_NAME}_${safeCat}_temporada.xlsx`;
  XLSX.writeFile(wb, filename);
}

// ---- Match detail ----
function renderMatchDetail(main){
  const match = state.matches.find(m=>m.id===openMatchId);
  if(!match){ openMatchId=null; render(); return; }
  ensureMatchStats(match);

  const top = document.createElement('div');
  top.className = 'top-bar';
  top.innerHTML = `<button class="back-btn">←</button><h3 style="margin:0;font-size:17px;">vs ${escapeHtml(match.rival)}</h3>`;
  top.querySelector('.back-btn').addEventListener('click', ()=>{ openMatchId=null; mainScrollTop = 0; render(); });
  main.appendChild(top);

  const gf = matchGoalsFavor(match);
  const board = document.createElement('div');
  board.className = 'score-board';
  board.innerHTML = `
    <div class="sub" style="color:var(--muted);font-size:12px;">${fmtDate(match.date)} · ${match.venue} · ${match.tipo || 'Liga'}</div>
    <div class="vs-line">
      <div>
        <div class="big">${gf}</div>
        <div class="team-label">${TEAM_NAME}</div>
      </div>
      <div style="color:var(--muted);font-size:22px;">–</div>
      <div>
        <div class="big">${match.golesContra}</div>
        <div class="team-label">
          ${escapeHtml(match.rival)}
          <button class="rival-edit-btn" id="rival-edit-btn" title="Corregir el nombre del rival">✎</button>
        </div>
      </div>
    </div>
    <div style="color:var(--muted);font-size:10.5px;margin-top:6px;">Solo lectura · las estadísticas se apuntan desde la pestaña Pista</div>
  `;
  board.querySelector('#rival-edit-btn').addEventListener('click', ()=>{
    modal = {type:'editRivalName', data:{matchId: match.id, name: match.rival}};
    render();
  });
  main.appendChild(board);

  // Ultimo gol anotado (o corregido), para revisar el partido despues
  const rosterForLog = playersOfCategory(match.categoria);
  const lastEntry = lastGoalEntry(match);
  const goalLogBox = document.createElement('div');
  goalLogBox.className = 'goal-log-summary';
  if(lastEntry){
    const row = goalLogRowText(lastEntry, rosterForLog);
    goalLogBox.innerHTML = `
      <span>${row.isCorrection ? 'Última corrección: ' : 'Último gol: '}<b>#${row.num} ${escapeHtml(row.name)}</b> · ${row.label} · ${row.time}</span>
      <button class="btn btn-ghost btn-small" id="goal-history-btn">Ver historial</button>
    `;
  } else {
    goalLogBox.innerHTML = `
      <span>No hay goles registrados</span>
      <button class="btn btn-ghost btn-small" id="goal-history-btn">Ver historial</button>
    `;
  }
  goalLogBox.querySelector('#goal-history-btn').addEventListener('click', ()=>{
    modal = {type:'goalHistory', data:{matchId: match.id}};
    render();
  });
  main.appendChild(goalLogBox);

  const exportRow = document.createElement('div');
  exportRow.style.marginBottom = '10px';
  exportRow.innerHTML = `<button class="btn btn-ghost btn-block">⬇ Exportar a Excel</button>`;
  exportRow.querySelector('button').addEventListener('click', ()=>{
    try{
      exportMatchExcel(match);
    }catch(e){
      showToast('No se pudo generar el Excel.');
    }
  });
  main.appendChild(exportRow);

  const delRow = document.createElement('div');
  delRow.style.marginBottom = '14px';
  delRow.innerHTML = `<button class="btn btn-danger btn-block">Eliminar partido</button>`;
  delRow.querySelector('button').addEventListener('click', ()=>{
    showConfirm('¿Eliminar este partido y sus estadísticas? No se puede deshacer.', ()=>{
      state.matches = state.matches.filter(m=>m.id!==match.id);
      openMatchId = null;
      saveState(); render();
    });
  });
  main.appendChild(delRow);

  const roster = playersOfCategory(match.categoria);
  if(roster.length===0){
    const e = document.createElement('div');
    e.className = 'empty';
    e.textContent = 'No hay jugadores en esta categoría.';
    main.appendChild(e);
    return;
  }

  const cards = [];
  roster.forEach(p=>{
    const s = match.stats.find(s=>s.playerId===p.id);
    if(!s) return;
    const label = p.role === 'entrenador' ? 'E' : (p.number ?? '');
    if((s.amarillas||0) > 0) cards.push({label, name:p.name, type:'amarilla', count:s.amarillas});
    if((s.rojas||0) > 0) cards.push({label, name:p.name, type:'roja', count:s.rojas});
  });
  if(cards.length){
    const cardsRow = document.createElement('div');
    cardsRow.className = 'cards-row';
    cardsRow.innerHTML = cards.map(c=>`
      <div class="card-chip" title="${escapeAttr(c.name)}">
        <span class="card-chip-num">#${c.label}</span>
        <span class="card-chip-square card-chip-${c.type}"></span>
        ${c.count > 1 ? `<span class="card-chip-count">×${c.count}</span>` : ''}
      </div>
    `).join('');
    main.appendChild(cardsRow);
  }

  const grid = document.createElement('div');
  grid.className = 'player-grid';
  sortRoster(roster).forEach(p=>{
    const isCoach = p.role === 'entrenador';
    const headline = statHeadline(p, {
      goles: playerGoals(match, p.id),
      paradas: playerSaves(match, p.id),
      sanciones: playerSanctions(match, p.id),
    });
    const tile = document.createElement('div');
    tile.className = 'player-tile' + (isCoach ? ' is-coach' : '');
    tile.innerHTML = `
      <div class="tile-num${isCoach?' is-coach':''}">${isCoach ? 'E' : (p.number ?? '')}</div>
      <div class="tile-name">${escapeHtml(p.name)}</div>
      <div class="tile-goals">${headline.value}</div>
      ${!isCoach ? `<div class="tile-mins">${fmtMinutes(playerPlayedSeconds(match, p.id))}</div>` : ''}
    `;
    tile.addEventListener('click', ()=>{
      modal = {type:'playerStatsView', data:{matchId: match.id, playerId: p.id}};
      render();
    });
    grid.appendChild(tile);
  });
  main.appendChild(grid);
}

// ---- Jugadores ----
function renderPlayers(main){
  const btnRow = document.createElement('div');
  btnRow.className = 'fab-row';
  btnRow.innerHTML = `<button class="btn btn-accent btn-block">+ Añadir a la plantilla de ${activeCategory}</button>`;
  btnRow.querySelector('button').addEventListener('click', ()=>{
    modal = {type:'newPlayer', data:{name:'', number:'', position:POSITIONS[0], role:'jugadora'}};
    render();
  });
  main.appendChild(btnRow);

  const players = playersOfCategory(activeCategory);
  if(players.length===0){
    const e = document.createElement('div');
    e.className = 'empty';
    e.textContent = `Todavía no hay jugadores en ${activeCategory}.`;
    main.appendChild(e);
    return;
  }

  const sorted = sortRoster(players);
  const grid = document.createElement('div');
  grid.className = 'card-grid';
  sorted.forEach(p=>{
    const isCoach = p.role === 'entrenador';
    const card = document.createElement('div');
    card.className = 'card';
    card.innerHTML = `
      <div class="player-header-row">
        <div style="display:flex;align-items:center;gap:11px;">
          <div class="dorsal${isCoach?' is-coach':''}">${isCoach ? 'E' : (p.number ?? '')}</div>
          <div>
            <div class="pname" style="font-size:15px;font-weight:600;">${escapeHtml(p.name)}</div>
            <div class="ppos">${isCoach ? 'Cuerpo técnico' : escapeHtml(p.position)}</div>
          </div>
        </div>
        <div style="display:flex;gap:4px;">
          <button class="icon-btn edit-p">✎</button>
          <button class="icon-btn del-p">✕</button>
        </div>
      </div>
    `;
    card.querySelector('.edit-p').addEventListener('click', ()=>{
      modal = {type:'editPlayer', data:{...p}};
      render();
    });
    card.querySelector('.del-p').addEventListener('click', ()=>{
      showConfirm(`¿Eliminar a ${p.name}? Se borrarán sus estadísticas de todos los partidos.`, ()=>{
        state.players = state.players.filter(x=>x.id!==p.id);
        state.matches.forEach(m=> m.stats = m.stats.filter(s=>s.playerId!==p.id));
        saveState(); render();
      });
    });
    grid.appendChild(card);
  });
  main.appendChild(grid);
}

// ---- Resumen ----
const SORT_OPTIONS = [
  {key:'totalGoles', label:'Goles', get:(s)=> GOAL_KEYS.reduce((a,k)=>a+(s[k]||0),0)},
  {key:'totalParadas', label:'Paradas', get:(s)=> SAVE_KEYS.reduce((a,k)=>a+(s[k]||0),0)},
  {key:'totalSanciones', label:'Sanciones', get:(s)=> SANCTION_KEYS.reduce((a,k)=>a+(s[k]||0),0)},
  {key:'minutosJugados', label:'Minutos', get:(s)=> Math.round((s.segundosJugados||0)/60)},
  ...ALL_STAT_FIELDS.map(f=>({key:f.key, label:f.label, get:(s)=> s[f.key]||0}))
];

function renderResumen(main){
  const matches = matchesOfCategory(activeCategory);
  const players = playersOfCategory(activeCategory);
  let w=0,d=0,l=0,gf=0,gc=0;
  matches.forEach(m=>{
    const favor = matchGoalsFavor(m);
    gf+=favor; gc+=m.golesContra;
    if(favor>m.golesContra) w++;
    else if(favor<m.golesContra) l++;
    else d++;
  });

  const summary = document.createElement('div');
  summary.className = 'summary-card';
  summary.innerHTML = `
    <div><div class="snum" style="color:var(--good);">${w}</div><div class="slbl">Ganados</div></div>
    <div><div class="snum" style="color:var(--muted);">${d}</div><div class="slbl">Empates</div></div>
    <div><div class="snum" style="color:var(--accent-2);">${l}</div><div class="slbl">Perdidos</div></div>
    <div><div class="snum">${gf}-${gc}</div><div class="slbl">Goles F-C</div></div>
  `;
  main.appendChild(summary);

  if(matches.length > 0){
    const exportRow = document.createElement('div');
    exportRow.style.marginBottom = '16px';
    exportRow.innerHTML = `<button class="btn btn-ghost btn-block">⬇ Exportar temporada a Excel</button>`;
    exportRow.querySelector('button').addEventListener('click', ()=>{
      try{
        exportSeasonExcel(activeCategory);
      }catch(e){
        showToast('No se pudo generar el Excel.');
      }
    });
    main.appendChild(exportRow);
  }

  if(players.length===0 || matches.length===0){
    const e = document.createElement('div');
    e.className = 'empty';
    e.textContent = `Cuando registres jugadores y partidos en ${activeCategory}, aquí verás el ranking de la temporada.`;
    main.appendChild(e);
    return;
  }

  const sortRow = document.createElement('div');
  sortRow.className = 'sort-row';
  const tabs = document.createElement('div');
  tabs.className = 'sort-tabs';
  tabs.id = 'sort-tabs';
  SORT_OPTIONS.forEach(o=>{
    const b = document.createElement('button');
    b.className = o.key===sortStat ? 'active' : '';
    b.textContent = o.label;
    b.addEventListener('click', ()=>{
      sortStat=o.key;
      render();
      const scroller = document.getElementById('sort-tabs');
      const active = scroller ? scroller.querySelector('button.active') : null;
      if(scroller && active){
        const target = Math.max(0, active.offsetLeft - scroller.clientWidth/2 + active.clientWidth/2);
        scroller.scrollTo({left: target, behavior:'auto'});
        sortScrollLeft = target;
      }
    });
    tabs.appendChild(b);
  });
  tabs.scrollLeft = sortScrollLeft; // restaura la posición: un repintado no debe volver al principio
  tabs.addEventListener('scroll', ()=>{ sortScrollLeft = tabs.scrollLeft; });
  const sortPrev = document.createElement('button');
  sortPrev.className = 'sort-arrow';
  sortPrev.textContent = '‹';
  sortPrev.addEventListener('click', ()=> tabs.scrollBy({left:-130, behavior:'auto'}));
  const sortNext = document.createElement('button');
  sortNext.className = 'sort-arrow';
  sortNext.textContent = '›';
  sortNext.addEventListener('click', ()=> tabs.scrollBy({left:130, behavior:'auto'}));
  sortRow.appendChild(sortPrev);
  sortRow.appendChild(tabs);
  sortRow.appendChild(sortNext);
  main.appendChild(sortRow);

  const activeOpt = SORT_OPTIONS.find(o=>o.key===sortStat) || SORT_OPTIONS[0];
  const totals = players.map(p=>{
    let total = 0, matchesPlayed = 0;
    matches.forEach(m=>{
      const s = m.stats.find(s=>s.playerId===p.id);
      if(s){
        total += activeOpt.get(s);
        if(ALL_STAT_FIELDS.some(f=> (s[f.key]||0) > 0)) matchesPlayed++;
      }
    });
    return {player:p, total, matchesPlayed};
  }).sort((a,b)=> b.total - a.total);

  const rankCard = document.createElement('div');
  rankCard.className = 'card';
  rankCard.style.padding = '4px 0';
  totals.forEach((t,i)=>{
    const row = document.createElement('div');
    row.className = 'ranking-row';
    row.innerHTML = `
      <div class="rank-pos">${i+1}</div>
      <div style="flex:1;">
        <div class="rank-name">${escapeHtml(t.player.name)}</div>
        <div class="rank-sub">${t.player.position} · ${t.matchesPlayed} partido${t.matchesPlayed===1?'':'s'}</div>
      </div>
      <div class="rank-val">${t.total}</div>
    `;
    row.addEventListener('click', ()=>{
      modal = {type:'seasonStats', data:{playerId: t.player.id}};
      render();
    });
    rankCard.appendChild(row);
  });
  main.appendChild(rankCard);
}

// ---- Modal ----
function renderModal(app){
  const bg = document.createElement('div');
  bg.className = 'modal-bg';
  bg.addEventListener('click', (e)=>{ if(e.target===bg){ modal=null; render(); } });

  const box = document.createElement('div');
  box.className = 'modal';

  if(modal.type==='newMatch'){
    box.innerHTML = `
      <h3>Nuevo partido</h3>
      <div class="modal-cat">Categoría: ${activeCategory}</div>
      <div class="form">
        <div><label>Fecha</label><input type="date" id="m-date" value="${modal.data.date}"></div>
        <div><label>Rival</label><input type="text" id="m-rival" placeholder="Nombre del equipo rival" value="${escapeAttr(modal.data.rival)}"></div>
        <div>
          <label>Tipo de partido</label>
          <div class="segmented" id="tipo-seg">
            <button type="button" data-t="Liga" class="${modal.data.tipo==='Liga'?'active':''}">Liga</button>
            <button type="button" data-t="Amistoso" class="${modal.data.tipo==='Amistoso'?'active':''}">Amistoso</button>
          </div>
        </div>
        <div>
          <label>Sede</label>
          <div class="segmented" id="venue-seg">
            <button type="button" data-v="Local" class="${modal.data.venue==='Local'?'active':''}">Local</button>
            <button type="button" data-v="Visitante" class="${modal.data.venue==='Visitante'?'active':''}">Visitante</button>
          </div>
        </div>
      </div>
      <div class="modal-actions">
        <button class="btn btn-ghost" id="m-cancel">Cancelar</button>
        <button class="btn btn-accent" id="m-save">Crear partido</button>
      </div>
    `;
    box.querySelector('#m-date').addEventListener('input', (e)=>{ modal.data.date = e.target.value; });
    box.querySelector('#m-rival').addEventListener('input', (e)=>{ modal.data.rival = e.target.value; });
    box.querySelector('#venue-seg').querySelectorAll('button').forEach(b=>{
      b.addEventListener('click', ()=>{ modal.data.venue=b.dataset.v; render(); });
    });
    box.querySelector('#tipo-seg').querySelectorAll('button').forEach(b=>{
      b.addEventListener('click', ()=>{ modal.data.tipo=b.dataset.t; render(); });
    });
    box.querySelector('#m-cancel').addEventListener('click', ()=>{ modal=null; render(); });
    box.querySelector('#m-save').addEventListener('click', ()=>{
      const date = box.querySelector('#m-date').value || new Date().toISOString().slice(0,10);
      const rival = box.querySelector('#m-rival').value.trim() || 'Rival';
      const match = { id: uid(), categoria: activeCategory, date, rival, venue: modal.data.venue, tipo: modal.data.tipo || 'Liga', golesContra:0, onCourt:[], stats: [] };
      ensureMatchStats(match);
      state.matches.push(match);
      modal = null;
      if(view === 'pista'){
        pistaMatchId = match.id;
      } else {
        openMatchId = match.id;
      }
      saveState(); render();
    });
  }

  if(modal.type==='newPlayer' || modal.type==='editPlayer'){
    const isEdit = modal.type==='editPlayer';
    const isCoach = modal.data.role === 'entrenador';
    box.innerHTML = `
      <h3>${isEdit ? 'Editar' : 'Añadir a la plantilla'}</h3>
      <div class="modal-cat">Categoría: ${activeCategory}</div>
      <div class="form">
        <div>
          <label>Tipo</label>
          <div class="segmented" id="role-seg">
            <button type="button" data-r="jugadora" class="${!isCoach?'active':''}">Jugadora</button>
            <button type="button" data-r="entrenador" class="${isCoach?'active':''}">Entrenador/a</button>
          </div>
        </div>
        <div id="p-fields-jugadora" ${isCoach?'style="display:none;"':''}>
          <div class="row2">
            <div><label>Dorsal</label><input type="number" id="p-num" min="0" max="99" value="${modal.data.number ?? ''}"></div>
            <div style="flex:2;"><label>Nombre</label><input type="text" id="p-name-j" placeholder="Nombre y apellido" value="${escapeAttr(isCoach?'':modal.data.name)}"></div>
          </div>
          <div>
            <label>Posición</label>
            <select id="p-pos">
              ${POSITIONS.map(pos=>`<option ${pos===modal.data.position?'selected':''}>${pos}</option>`).join('')}
            </select>
          </div>
        </div>
        <div id="p-fields-entrenador" ${isCoach?'':'style="display:none;"'}>
          <label>Nombre</label>
          <input type="text" id="p-name-e" placeholder="Nombre y apellido" value="${escapeAttr(isCoach?modal.data.name:'')}">
        </div>
      </div>
      <div class="modal-actions">
        <button class="btn btn-ghost" id="p-cancel">Cancelar</button>
        <button class="btn btn-accent" id="p-save">${isEdit?'Guardar':'Añadir'}</button>
      </div>
    `;
    box.querySelector('#role-seg').querySelectorAll('button').forEach(b=>{
      b.addEventListener('click', ()=>{
        const currentInput = box.querySelector(isCoach ? '#p-name-e' : '#p-name-j');
        if(currentInput) modal.data.name = currentInput.value;
        const numInput = box.querySelector('#p-num');
        if(numInput) modal.data.number = numInput.value;
        const posSelect = box.querySelector('#p-pos');
        if(posSelect) modal.data.position = posSelect.value;
        modal.data.role = b.dataset.r;
        render();
      });
    });
    box.querySelector('#p-cancel').addEventListener('click', ()=>{ modal=null; render(); });
    box.querySelector('#p-save').addEventListener('click', ()=>{
      const role = modal.data.role === 'entrenador' ? 'entrenador' : 'jugadora';
      const nameInput = role==='entrenador' ? box.querySelector('#p-name-e') : box.querySelector('#p-name-j');
      const name = nameInput.value.trim();
      if(!name){ showToast('Escribe un nombre'); return; }
      let number = null, position = 'Entrenador/a';
      if(role==='jugadora'){
        number = parseInt(box.querySelector('#p-num').value) || 0;
        position = box.querySelector('#p-pos').value;
      }
      if(isEdit){
        const p = state.players.find(x=>x.id===modal.data.id);
        p.name=name; p.role=role; p.number=number; p.position=position;
      } else {
        state.players.push({id:uid(), categoria: activeCategory, name, role, number, position});
      }
      modal = null;
      saveState(); render();
    });
  }

  if(modal.type==='playerStats'){
    const match = state.matches.find(m=>m.id===modal.data.matchId);
    const p = state.players.find(x=>x.id===modal.data.playerId);
    if(!match || !p){ modal=null; render(); return; }
    const isCoach = p.role === 'entrenador';
    const headline = statHeadline(p, {
      goles: playerGoals(match, p.id),
      paradas: playerSaves(match, p.id),
      sanciones: playerSanctions(match, p.id),
    });
    const fields = getStatFields(p);
    const minutosLine = !isCoach ? `<div class="ppos">⏱ ${fmtMinutes(playerPlayedSeconds(match, p.id))} jugados</div>` : '';
    box.innerHTML = `
      <div class="stat-modal-head">
        <div class="dorsal${isCoach?' is-coach':''}">${isCoach ? 'E' : (p.number ?? '')}</div>
        <div>
          <div class="pname">${escapeHtml(p.name)}</div>
          <div class="ppos">${isCoach ? 'Cuerpo técnico' : escapeHtml(p.position)}</div>
          ${minutosLine}
        </div>
        <div class="stat-modal-goals">
          <div class="snum">${headline.value}</div>
          <div class="slbl">${headline.label}</div>
        </div>
      </div>
      <div class="stat-modal-grid">
        ${fields.map(f=>`
          <div class="stat-box">
            <div class="slabel">${f.label}</div>
            <div class="sctrl">
              <button data-key="${f.key}" data-d="-1">−</button>
              <div class="sval">${getStat(match,p.id,f.key)}</div>
              <button data-key="${f.key}" data-d="1">+</button>
            </div>
          </div>
        `).join('')}
      </div>
      <div class="modal-actions">
        <button class="btn btn-accent btn-block" id="ps-close">Cerrar</button>
      </div>
    `;
    box.querySelectorAll('.stat-box button').forEach(b=>{
      b.addEventListener('click', ()=>{
        bumpStat(match.id, p.id, b.dataset.key, parseInt(b.dataset.d));
      });
    });
    box.querySelector('#ps-close').addEventListener('click', ()=>{ modal=null; render(); });
  }

  if(modal.type==='playerStatsView'){
    const match = state.matches.find(m=>m.id===modal.data.matchId);
    const p = state.players.find(x=>x.id===modal.data.playerId);
    if(!match || !p){ modal=null; render(); return; }
    const isCoach = p.role === 'entrenador';
    const headline = statHeadline(p, {
      goles: playerGoals(match, p.id),
      paradas: playerSaves(match, p.id),
      sanciones: playerSanctions(match, p.id),
    });
    const fields = getStatFields(p);
    const minutosLine = !isCoach ? `<div class="ppos">⏱ ${fmtMinutes(playerPlayedSeconds(match, p.id))} jugados</div>` : '';
    box.innerHTML = `
      <div class="stat-modal-head">
        <div class="dorsal${isCoach?' is-coach':''}">${isCoach ? 'E' : (p.number ?? '')}</div>
        <div>
          <div class="pname">${escapeHtml(p.name)}</div>
          <div class="ppos">${isCoach ? 'Cuerpo técnico' : escapeHtml(p.position)}</div>
          ${minutosLine}
        </div>
        <div class="stat-modal-goals">
          <div class="snum">${headline.value}</div>
          <div class="slbl">${headline.label}</div>
        </div>
      </div>
      <div class="stat-modal-grid">
        ${fields.map(f=>`
          <div class="stat-box stat-box-ro">
            <div class="slabel">${f.label}</div>
            <div class="sval-ro">${getStat(match,p.id,f.key)}</div>
          </div>
        `).join('')}
      </div>
      <div class="modal-actions">
        <button class="btn btn-accent btn-block" id="psv-close">Cerrar</button>
      </div>
    `;
    box.querySelector('#psv-close').addEventListener('click', ()=>{ modal=null; render(); });
  }

  if(modal.type==='seasonStats'){
    const p = state.players.find(x=>x.id===modal.data.playerId);
    if(!p){ modal=null; render(); return; }
    const isCoach = p.role === 'entrenador';
    const {totals, matchesPlayed, totalGoles, totalParadas, totalSanciones, totalSegundos} = computeSeasonTotals(p, activeCategory);
    const headline = statHeadline(p, {goles: totalGoles, paradas: totalParadas, sanciones: totalSanciones});
    const fields = getStatFields(p);
    const minutosLine = !isCoach ? `<div class="ppos">⏱ ${fmtMinutes(totalSegundos)} jugados en total</div>` : '';
    box.innerHTML = `
      <div class="stat-modal-head">
        <div class="dorsal${isCoach?' is-coach':''}">${isCoach ? 'E' : (p.number ?? '')}</div>
        <div>
          <div class="pname">${escapeHtml(p.name)}</div>
          <div class="ppos">${isCoach ? 'Cuerpo técnico' : escapeHtml(p.position)} · ${matchesPlayed} partido${matchesPlayed===1?'':'s'}</div>
          ${minutosLine}
        </div>
        <div class="stat-modal-goals">
          <div class="snum">${headline.value}</div>
          <div class="slbl">${headline.label} temporada</div>
        </div>
      </div>
      <div class="stat-modal-grid">
        ${fields.map(f=>`
          <div class="stat-box stat-box-ro">
            <div class="slabel">${f.label}</div>
            <div class="sval-ro">${totals[f.key]}</div>
          </div>
        `).join('')}
      </div>
      <div class="modal-actions">
        <button class="btn btn-accent btn-block" id="ss-close">Cerrar</button>
      </div>
    `;
    box.querySelector('#ss-close').addEventListener('click', ()=>{ modal=null; render(); });
  }

  if(modal.type==='clubPanel'){
    renderClubPanelModal(box);
  }

  if(modal.type==='editRivalName'){
    box.innerHTML = `
      <h3>Nombre del rival</h3>
      <div class="form">
        <div><label>Rival</label><input type="text" id="rival-name-input" value="${escapeAttr(modal.data.name)}" placeholder="Nombre del equipo rival"></div>
      </div>
      <div class="modal-actions">
        <button class="btn btn-ghost" id="rn-cancel">Cancelar</button>
        <button class="btn btn-accent" id="rn-save">Guardar</button>
      </div>
    `;
    box.querySelector('#rn-cancel').addEventListener('click', ()=>{ modal=null; render(); });
    box.querySelector('#rn-save').addEventListener('click', ()=>{
      const val = box.querySelector('#rival-name-input').value.trim();
      if(!val){ showToast('Escribe un nombre'); return; }
      const match = state.matches.find(m=>m.id===modal.data.matchId);
      if(match) match.rival = val;
      modal = null;
      saveState(); render();
    });
  }

  if(modal.type==='goalHistory'){
    const match = state.matches.find(m=>m.id===modal.data.matchId);
    const rosterAll = match ? playersOfCategory(match.categoria) : [];
    const log = (match && match.goalLog) ? [...match.goalLog].reverse() : [];
    box.innerHTML = `
      <h3>Historial de goles</h3>
      <div class="goal-log-list">
        ${log.length===0 ? '<p style="color:var(--muted);font-size:13px;">Todavía no se ha anotado ningún gol.</p>' : log.map(entry=>{
          const row = goalLogRowText(entry, rosterAll);
          return `
            <div class="goal-log-row${row.isCorrection ? ' goal-log-row-neg' : ''}">
              <span class="goal-log-time">${row.time}</span>
              <span class="goal-log-player">#${row.num} ${escapeHtml(row.name)}</span>
              <span class="goal-log-type">${row.label}</span>
              <span class="goal-log-sign">${row.isCorrection ? '−' : '+'}</span>
            </div>
          `;
        }).join('')}
      </div>
      <div class="modal-actions">
        <button class="btn btn-accent btn-block" id="gh-close">Cerrar</button>
      </div>
    `;
    box.querySelector('#gh-close').addEventListener('click', ()=>{ modal=null; render(); });
  }

  if(modal.type==='confirm'){
    box.innerHTML = `
      <h3>Confirmar</h3>
      <p style="color:var(--muted);font-size:14px;line-height:1.5;margin:0 0 4px;">${escapeHtml(modal.data.message)}</p>
      <div class="modal-actions">
        <button class="btn btn-ghost" id="c-cancel">Cancelar</button>
        <button class="btn btn-danger-solid" id="c-confirm">Eliminar</button>
      </div>
    `;
    const onConfirm = modal.data.onConfirm;
    box.querySelector('#c-cancel').addEventListener('click', ()=>{ modal=null; render(); });
    box.querySelector('#c-confirm').addEventListener('click', ()=>{
      modal=null;
      onConfirm();
    });
  }

  if(modal.type==='info'){
    box.innerHTML = `
      <h3>${escapeHtml(modal.data.title || 'Aviso')}</h3>
      <p style="color:var(--muted);font-size:14px;line-height:1.5;margin:0 0 4px;">${modal.data.message}</p>
      <div class="modal-actions">
        <button class="btn btn-accent btn-block" id="info-close">Entendido</button>
      </div>
    `;
    box.querySelector('#info-close').addEventListener('click', ()=>{ modal=null; render(); });
  }

  box.addEventListener('click', e=>e.stopPropagation());
  bg.appendChild(box);
  app.appendChild(bg);
}

window.addEventListener('error', (e)=>{
  const app = document.getElementById('app');
  if(app && app.innerHTML.includes('Cargando datos')){
    app.innerHTML = '<div class="empty">Ha ocurrido un error al cargar la app.<br>Detalle: '+ (e.message||'desconocido') +'</div>';
  }
});

loadTheme();
// El arranque real (cargar la categoría, etc.) lo dispara app-auth.js
// en cuanto sabe si hay sesión iniciada y en qué club está la persona.

// Refresca el cronómetro cada segundo mientras esté en marcha y se esté viendo la pestaña Pista
setInterval(()=>{
  if(view === 'pista' && state && state.matches){
    const match = state.matches.find(m=>m.id===pistaMatchId);
    if(match && match.clock && match.clock.running){
      if(clockElapsedMs(match) >= MATCH_DURATION_MS){
        stopRunningAndSettle(match);
        saveState();
      }
      if(cleanupExpiredExclusions(match)){
        saveState();
      }
      render();
    }
  }
}, 1000);
