// app-auth.js: inicio de sesión, creación/unión a club, invitaciones y el interruptor
// que decide qué pantalla mostrar (login -> elegir/crear club -> app normal).

let currentUser = null;      // objeto de Firebase Auth, o null si no hay sesión
let userClubs = [];          // [{id, name, role}] — clubes a los que pertenece esta persona
let authMode = 'login';      // 'login' | 'signup' — qué formulario se ve
let authError = '';
let authBusy = false;
let clubSetupMode = 'choose'; // 'choose' | 'create' | 'join'
let newClubCategories = ['']; // filas del formulario de categorías al crear un club

function genInviteCode(){
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // sin caracteres ambiguos (0/O, 1/I, etc.)
  let code = '';
  for(let i=0;i<6;i++) code += chars[Math.floor(Math.random()*chars.length)];
  return code;
}

// ---------------- Sesión ----------------

async function signUp(email, password){
  authBusy = true; authError = ''; render();
  try{
    await auth.createUserWithEmailAndPassword(email.trim(), password);
  }catch(e){
    authError = friendlyAuthError(e);
    authBusy = false; render();
  }
}
async function logIn(email, password){
  authBusy = true; authError = ''; render();
  try{
    await auth.signInWithEmailAndPassword(email.trim(), password);
  }catch(e){
    authError = friendlyAuthError(e);
    authBusy = false; render();
  }
}
function logOut(){
  if(unsubscribeCategory){ unsubscribeCategory(); unsubscribeCategory = null; }
  currentClub = null; state = null; userClubs = [];
  auth.signOut();
}
function friendlyAuthError(e){
  const code = e && e.code || '';
  if(code.includes('email-already-in-use')) return 'Ese correo ya tiene una cuenta. Prueba a iniciar sesión.';
  if(code.includes('invalid-email')) return 'El correo no es válido.';
  if(code.includes('weak-password')) return 'La contraseña debe tener al menos 6 caracteres.';
  if(code.includes('user-not-found') || code.includes('wrong-password') || code.includes('invalid-credential')) return 'Correo o contraseña incorrectos.';
  if(code.includes('too-many-requests')) return 'Demasiados intentos. Espera un momento y prueba otra vez.';
  return 'Ha ocurrido un error. Inténtalo de nuevo.';
}

// ---------------- Clubes ----------------

// Lee los clubes de esta persona (guardados en users/{uid}.clubs) y, si solo pertenece a uno,
// entra directamente en él sin preguntar.
async function loadUserClubsAndProceed(){
  try{
    const userDoc = await db.collection('users').doc(currentUser.uid).get();
    userClubs = (userDoc.exists && userDoc.data().clubs) ? userDoc.data().clubs : [];
  }catch(e){
    userClubs = [];
  }
  if(userClubs.length === 1){
    await selectClub(userClubs[0].id);
  } else {
    render();
  }
}

async function selectClub(clubId){
  authBusy = true; render();
  try{
    const doc = await db.collection('clubs').doc(clubId).get();
    if(!doc.exists){ authBusy = false; showToast('Ese club ya no existe.'); render(); return; }
    const data = doc.data();
    currentClub = { id: clubId, name: data.name, categories: data.categories || [], code: data.inviteCode };
    TEAM_NAME = data.name;
    CATEGORIES = data.categories || [];
    activeCategory = CATEGORIES[0] || null;
    authBusy = false;
    if(activeCategory){
      loadCategory(activeCategory);
    } else {
      state = defaultState();
      render();
    }
  }catch(e){
    authBusy = false;
    showToast('No se pudo entrar en el club.');
    render();
  }
}

// Vuelve a la pantalla de elegir/crear club (para cambiar de club sin cerrar sesión)
function exitClub(){
  if(unsubscribeCategory){ unsubscribeCategory(); unsubscribeCategory = null; }
  currentClub = null; state = null;
  clubSetupMode = userClubs.length > 0 ? 'choose' : 'create';
  render();
}

async function createClub(name, categories){
  name = (name||'').trim();
  categories = categories.map(c=>c.trim()).filter(Boolean);
  if(!name){ authError = 'Ponle un nombre al club.'; render(); return; }
  if(categories.length === 0){ authError = 'Añade al menos una categoría.'; render(); return; }
  authBusy = true; authError = ''; render();
  try{
    const clubId = uid();
    const code = genInviteCode();
    await db.collection('clubs').doc(clubId).set({
      name, categories, ownerUid: currentUser.uid, inviteCode: code, createdAt: Date.now(),
    });
    await db.collection('clubs').doc(clubId).collection('members').doc(currentUser.uid).set({
      email: currentUser.email, role: 'owner', joinedAt: Date.now(),
    });
    await db.collection('inviteCodes').doc(code).set({ clubId });
    await db.collection('users').doc(currentUser.uid).set({
      email: currentUser.email,
      clubs: firebase.firestore.FieldValue.arrayUnion({ id: clubId, name, role: 'owner' }),
    }, { merge: true });
    userClubs.push({ id: clubId, name, role: 'owner' });
    authBusy = false;
    await selectClub(clubId);
  }catch(e){
    authBusy = false;
    authError = 'No se pudo crear el club. Revisa tu conexión.';
    render();
  }
}

async function joinClubWithCode(code){
  code = (code||'').trim().toUpperCase();
  if(!code){ authError = 'Escribe el código de invitación.'; render(); return; }
  authBusy = true; authError = ''; render();
  try{
    const codeDoc = await db.collection('inviteCodes').doc(code).get();
    if(!codeDoc.exists){
      authBusy = false; authError = 'Ese código no existe. Revísalo con quien te lo ha dado.'; render(); return;
    }
    const clubId = codeDoc.data().clubId;
    const clubDoc = await db.collection('clubs').doc(clubId).get();
    if(!clubDoc.exists){
      authBusy = false; authError = 'Ese club ya no existe.'; render(); return;
    }
    const alreadyMember = userClubs.some(c=>c.id===clubId);
    if(!alreadyMember){
      await db.collection('clubs').doc(clubId).collection('members').doc(currentUser.uid).set({
        email: currentUser.email, role: 'coach', joinedAt: Date.now(),
      });
      await db.collection('users').doc(currentUser.uid).set({
        email: currentUser.email,
        clubs: firebase.firestore.FieldValue.arrayUnion({ id: clubId, name: clubDoc.data().name, role: 'coach' }),
      }, { merge: true });
      userClubs.push({ id: clubId, name: clubDoc.data().name, role: 'coach' });
    }
    authBusy = false;
    await selectClub(clubId);
  }catch(e){
    authBusy = false;
    authError = 'No se pudo entrar con ese código. Revisa tu conexión.';
    render();
  }
}

// ---------------- Pantallas ----------------

function authCard(innerHtml){
  const wrap = document.createElement('div');
  wrap.className = 'auth-wrap';
  wrap.innerHTML = `
    <div class="auth-card">
      <div class="auth-logo">🤾</div>
      <h1 class="auth-title">Balonmano Stats</h1>
      <div class="auth-sub">Estadísticas de partidos para clubes de balonmano</div>
      ${innerHtml}
    </div>
  `;
  return wrap;
}

function renderAuthScreen(){
  const app = document.getElementById('app');
  app.innerHTML = '';
  const isLogin = authMode === 'login';
  const card = authCard(`
    <div class="segmented auth-mode-seg">
      <button type="button" data-m="login" class="${isLogin?'active':''}">Iniciar sesión</button>
      <button type="button" data-m="signup" class="${!isLogin?'active':''}">Crear cuenta</button>
    </div>
    <div class="form">
      <div><label>Correo</label><input type="email" id="auth-email" autocomplete="email" placeholder="tucorreo@ejemplo.com"></div>
      <div><label>Contraseña</label><input type="password" id="auth-password" autocomplete="${isLogin?'current-password':'new-password'}" placeholder="Al menos 6 caracteres"></div>
    </div>
    ${authError ? `<div class="auth-error">${escapeHtml(authError)}</div>` : ''}
    <button class="btn btn-accent btn-block" id="auth-submit" ${authBusy?'disabled':''}>${authBusy ? 'Un momento…' : (isLogin ? 'Entrar' : 'Crear cuenta')}</button>
  `);
  app.appendChild(card);

  card.querySelectorAll('.auth-mode-seg button').forEach(b=>{
    b.addEventListener('click', ()=>{ authMode = b.dataset.m; authError=''; render(); });
  });
  const submit = ()=>{
    const email = card.querySelector('#auth-email').value;
    const password = card.querySelector('#auth-password').value;
    if(!email || !password){ authError = 'Rellena correo y contraseña.'; render(); return; }
    isLogin ? logIn(email, password) : signUp(email, password);
  };
  card.querySelector('#auth-submit').addEventListener('click', submit);
  card.querySelector('#auth-password').addEventListener('keydown', (e)=>{ if(e.key==='Enter') submit(); });
}

function renderClubSetupScreen(){
  const app = document.getElementById('app');
  app.innerHTML = '';

  // Si tiene clubes y no ha elegido, mostramos el selector primero
  if(userClubs.length > 0 && clubSetupMode === 'choose'){
    const card = authCard(`
      <div class="auth-section-title">Tus clubes</div>
      <div class="club-list">
        ${userClubs.map(c=>`
          <button class="club-pick-btn" data-id="${escapeAttr(c.id)}">
            <span>${escapeHtml(c.name)}</span>
            <span class="club-pick-role">${c.role==='owner'?'Propietario/a':'Entrenador/a'}</span>
          </button>
        `).join('')}
      </div>
      <div class="auth-divider">o</div>
      <div class="auth-row-2">
        <button class="btn btn-ghost btn-block" id="cs-create">+ Crear otro club</button>
        <button class="btn btn-ghost btn-block" id="cs-join">Unirme con código</button>
      </div>
      <button class="btn btn-ghost btn-block auth-logout" id="cs-logout">Cerrar sesión</button>
    `);
    app.appendChild(card);
    card.querySelectorAll('.club-pick-btn').forEach(b=> b.addEventListener('click', ()=> selectClub(b.dataset.id)));
    card.querySelector('#cs-create').addEventListener('click', ()=>{ clubSetupMode='create'; newClubCategories=['']; authError=''; render(); });
    card.querySelector('#cs-join').addEventListener('click', ()=>{ clubSetupMode='join'; authError=''; render(); });
    card.querySelector('#cs-logout').addEventListener('click', logOut);
    return;
  }

  if(clubSetupMode === 'join'){
    const card = authCard(`
      <div class="auth-section-title">Unirme a un club</div>
      <div class="form">
        <div><label>Código de invitación</label><input type="text" id="join-code" maxlength="6" style="text-transform:uppercase;letter-spacing:2px;font-weight:700;" placeholder="ABC123"></div>
      </div>
      ${authError ? `<div class="auth-error">${escapeHtml(authError)}</div>` : ''}
      <button class="btn btn-accent btn-block" id="join-submit" ${authBusy?'disabled':''}>${authBusy?'Un momento…':'Unirme'}</button>
      <button class="btn btn-ghost btn-block" id="join-back">${userClubs.length>0 ? '← Volver' : '← Crear un club en su lugar'}</button>
      <button class="btn btn-ghost btn-block auth-logout" id="cs-logout">Cerrar sesión</button>
    `);
    app.appendChild(card);
    card.querySelector('#join-submit').addEventListener('click', ()=> joinClubWithCode(card.querySelector('#join-code').value));
    card.querySelector('#join-back').addEventListener('click', ()=>{ clubSetupMode = userClubs.length>0 ? 'choose' : 'create'; authError=''; render(); });
    card.querySelector('#cs-logout').addEventListener('click', logOut);
    return;
  }

  // clubSetupMode === 'create'
  const card = authCard(`
    <div class="auth-section-title">Crea tu club</div>
    <div class="form">
      <div><label>Nombre del club</label><input type="text" id="new-club-name" placeholder="Ej. CH Martorell"></div>
      <div><label>Categorías</label></div>
      <div id="new-club-cats"></div>
      <button class="btn btn-ghost btn-small" id="add-cat-row" type="button">+ Añadir categoría</button>
    </div>
    ${authError ? `<div class="auth-error">${escapeHtml(authError)}</div>` : ''}
    <button class="btn btn-accent btn-block" id="create-submit" ${authBusy?'disabled':''}>${authBusy?'Un momento…':'Crear club'}</button>
    ${userClubs.length>0 ? '<button class="btn btn-ghost btn-block" id="create-back">← Volver</button>' : ''}
    <button class="btn btn-ghost btn-block" id="cs-join-instead">¿Tienes un código de invitación? Únete a un club existente</button>
    <button class="btn btn-ghost btn-block auth-logout" id="cs-logout">Cerrar sesión</button>
  `);
  app.appendChild(card);

  const catsWrap = card.querySelector('#new-club-cats');
  function renderCatRows(){
    catsWrap.innerHTML = newClubCategories.map((val, i)=>`
      <div class="cat-row-input">
        <input type="text" class="cat-row-field" data-i="${i}" value="${escapeAttr(val)}" placeholder="Ej. Infantil">
        ${newClubCategories.length>1 ? `<button type="button" class="cat-row-del" data-i="${i}">✕</button>` : ''}
      </div>
    `).join('');
    catsWrap.querySelectorAll('.cat-row-field').forEach(inp=>{
      inp.addEventListener('input', ()=>{ newClubCategories[+inp.dataset.i] = inp.value; });
    });
    catsWrap.querySelectorAll('.cat-row-del').forEach(btn=>{
      btn.addEventListener('click', ()=>{ newClubCategories.splice(+btn.dataset.i,1); renderCatRows(); });
    });
  }
  renderCatRows();
  card.querySelector('#add-cat-row').addEventListener('click', ()=>{ newClubCategories.push(''); renderCatRows(); });
  card.querySelector('#create-submit').addEventListener('click', ()=>{
    createClub(card.querySelector('#new-club-name').value, newClubCategories);
  });
  if(card.querySelector('#create-back')){
    card.querySelector('#create-back').addEventListener('click', ()=>{ clubSetupMode='choose'; authError=''; render(); });
  }
  card.querySelector('#cs-join-instead').addEventListener('click', ()=>{ clubSetupMode='join'; authError=''; render(); });
  card.querySelector('#cs-logout').addEventListener('click', logOut);
}

// Panel del club: código de invitación y miembros. Se abre desde el botón "Club" de la cabecera.
function renderClubPanelModal(box){
  box.innerHTML = `<div class="empty">Cargando…</div>`;
  db.collection('clubs').doc(currentClub.id).collection('members').get().then(snap=>{
    const members = [];
    snap.forEach(d=> members.push(d.data()));
    box.innerHTML = `
      <h3>${escapeHtml(currentClub.name)}</h3>
      <div class="auth-section-title" style="margin-top:10px;">Código de invitación</div>
      <div class="invite-code-box">${escapeHtml(currentClub.code||'—')}</div>
      <div class="goal-log-summary" style="justify-content:center;">Compártelo con el resto del cuerpo técnico para que se unan a este club.</div>
      <div class="auth-section-title" style="margin-top:14px;">Cuerpo técnico</div>
      <div class="goal-log-list">
        ${members.map(m=>`
          <div class="goal-log-row">
            <span class="goal-log-player">${escapeHtml(m.email||'')}</span>
            <span class="goal-log-type">${m.role==='owner'?'Propietario/a':'Entrenador/a'}</span>
          </div>
        `).join('')}
      </div>
      <div class="modal-actions" style="margin-top:14px;">
        ${userClubs.length>1 ? '<button class="btn btn-ghost" id="club-switch">Cambiar de club</button>' : ''}
        <button class="btn btn-ghost" id="club-logout">Cerrar sesión</button>
        <button class="btn btn-accent" id="club-panel-close">Cerrar</button>
      </div>
    `;
    box.querySelector('#club-panel-close').addEventListener('click', ()=>{ modal=null; render(); });
    box.querySelector('#club-logout').addEventListener('click', logOut);
    const switchBtn = box.querySelector('#club-switch');
    if(switchBtn) switchBtn.addEventListener('click', ()=>{ modal=null; exitClub(); });
  }).catch(()=>{
    box.innerHTML = `<p style="color:var(--muted);font-size:13px;">No se pudo cargar la información del club.</p>
      <div class="modal-actions"><button class="btn btn-accent" id="club-panel-close">Cerrar</button></div>`;
    box.querySelector('#club-panel-close').addEventListener('click', ()=>{ modal=null; render(); });
  });
}

// ---------------- El interruptor: decide qué pantalla tocaba mostrar ----------------

function render(){
  if(!firebaseReady){
    document.getElementById('app').innerHTML = '<div class="empty">Falta configurar Firebase: revisa firebaseConfig en app-core.js.</div>';
    return;
  }
  if(!currentUser){ renderAuthScreen(); return; }
  if(!currentClub){ renderClubSetupScreen(); return; }
  renderApp();
}

auth.onAuthStateChanged(async (user)=>{
  currentUser = user;
  if(user){
    await loadUserClubsAndProceed();
  } else {
    userClubs = [];
    currentClub = null;
    state = null;
    render();
  }
});
