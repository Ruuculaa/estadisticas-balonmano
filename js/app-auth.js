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
async function signInWithGoogle(){
  authBusy = true; authError = ''; render();
  try{
    const provider = new firebase.auth.GoogleAuthProvider();
    await auth.signInWithPopup(provider);
  }catch(e){
    if(e && e.code === 'auth/popup-closed-by-user'){
      authBusy = false; render(); return; // ha cerrado la ventana, no es un error real
    }
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
  if(code.includes('popup-blocked')) return 'El navegador ha bloqueado la ventana de Google. Permite ventanas emergentes e inténtalo otra vez.';
  if(code.includes('account-exists-with-different-credential')) return 'Ese correo ya tiene una cuenta creada con contraseña. Inicia sesión con correo y contraseña.';
  if(code.includes('unauthorized-domain')) return 'Este dominio todavía no está autorizado en Firebase (Authentication → Settings → Authorized domains).';
  return code ? `Ha ocurrido un error (${code}). Inténtalo de nuevo.` : 'Ha ocurrido un error. Inténtalo de nuevo.';
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
    const myEntry = userClubs.find(c => c.id === clubId);
    currentClub = { id: clubId, name: data.name, categories: data.categories || [], code: data.inviteCode, logo: data.logo || null, myRole: myEntry ? myEntry.role : 'coach' };
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
    await db.collection('inviteCodes').doc(code).set({ clubId, clubName: name });
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
    const clubName = codeDoc.data().clubName || 'Club';
    const alreadyMember = userClubs.some(c=>c.id===clubId);
    if(!alreadyMember){
      // Primero nos unimos (esto sí está permitido: solo te puedes añadir a ti mismo/a).
      // Recién entonces podemos leer los datos del club, porque las reglas exigen ya ser miembro.
      await db.collection('clubs').doc(clubId).collection('members').doc(currentUser.uid).set({
        email: currentUser.email, role: 'coach', joinedAt: Date.now(),
      });
      await db.collection('users').doc(currentUser.uid).set({
        email: currentUser.email,
        clubs: firebase.firestore.FieldValue.arrayUnion({ id: clubId, name: clubName, role: 'coach' }),
      }, { merge: true });
      userClubs.push({ id: clubId, name: clubName, role: 'coach' });
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
  const card = authCard(`
    <button class="btn btn-google btn-block" id="auth-google" ${authBusy?'disabled':''}>
      <svg width="18" height="18" viewBox="0 0 18 18" style="flex-shrink:0;"><path fill="#4285F4" d="M17.64 9.2c0-.64-.06-1.25-.16-1.84H9v3.48h4.84c-.21 1.13-.84 2.09-1.8 2.73v2.27h2.91c1.7-1.57 2.69-3.87 2.69-6.64z"/><path fill="#34A853" d="M9 18c2.43 0 4.47-.8 5.96-2.17l-2.91-2.27c-.81.54-1.84.86-3.05.86-2.34 0-4.33-1.58-5.04-3.71H.96v2.34C2.44 15.98 5.48 18 9 18z"/><path fill="#FBBC05" d="M3.96 10.71A5.4 5.4 0 0 1 3.68 9c0-.59.1-1.17.28-1.71V4.95H.96A9 9 0 0 0 0 9c0 1.45.35 2.83.96 4.05l3-2.34z"/><path fill="#EA4335" d="M9 3.58c1.32 0 2.51.45 3.44 1.35l2.58-2.58C13.46.89 11.43 0 9 0 5.48 0 2.44 2.02.96 4.95l3 2.34C4.67 5.16 6.66 3.58 9 3.58z"/></svg>
      <span>${authBusy ? 'Un momento…' : 'Continuar con Google'}</span>
    </button>
    ${authError ? `<div class="auth-error">${escapeHtml(authError)}</div>` : ''}
  `);
  app.appendChild(card);
  card.querySelector('#auth-google').addEventListener('click', signInWithGoogle);
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
      <div class="auth-row-2">
        <button class="btn btn-ghost" id="cs-create">+ Crear club</button>
        <button class="btn btn-ghost" id="cs-join">Unirme con código</button>
      </div>
      <div class="auth-links">
        <button class="auth-link-btn" id="cs-logout">Cerrar sesión</button>
      </div>
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
        <div><label>Código de invitación</label><input type="text" id="join-code" maxlength="6" style="text-transform:uppercase;letter-spacing:3px;font-weight:700;text-align:center;" placeholder="ABC123"></div>
      </div>
      ${authError ? `<div class="auth-error">${escapeHtml(authError)}</div>` : ''}
      <button class="btn btn-accent btn-block" id="join-submit" ${authBusy?'disabled':''}>${authBusy?'Un momento…':'Unirme'}</button>
      <div class="auth-links">
        <button class="auth-link-btn" id="join-back">${userClubs.length>0 ? '← Volver' : '← Crear un club en su lugar'}</button>
        <button class="auth-link-btn" id="cs-logout">Cerrar sesión</button>
      </div>
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
    </div>
    <div class="new-club-cats-label"><label>Categorías</label></div>
    <div id="new-club-cats"></div>
    <button class="add-cat-btn" id="add-cat-row" type="button">+ Añadir categoría</button>
    ${authError ? `<div class="auth-error">${escapeHtml(authError)}</div>` : ''}
    <button class="btn btn-accent btn-block" id="create-submit" style="margin-top:18px;" ${authBusy?'disabled':''}>${authBusy?'Un momento…':'Crear club'}</button>
    <div class="auth-links">
      ${userClubs.length>0 ? '<button class="auth-link-btn" id="create-back">← Volver</button>' : ''}
      <button class="auth-link-btn" id="cs-join-instead">¿Tienes un código de invitación? Únete a un club existente</button>
      <button class="auth-link-btn" id="cs-logout">Cerrar sesión</button>
    </div>
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
// Redimensiona la imagen elegida a un cuadrado pequeño (128x128) antes de guardarla, para que
// quepa de sobra en el documento del club (que tiene un límite de 1 MB) y cargue rápido.
function resizeImageFileToDataUrl(file, size){
  return new Promise((resolve, reject)=>{
    if(!file.type.startsWith('image/')){ reject(new Error('not-an-image')); return; }
    const reader = new FileReader();
    reader.onerror = ()=> reject(new Error('read-error'));
    reader.onload = ()=>{
      const img = new Image();
      img.onerror = ()=> reject(new Error('decode-error'));
      img.onload = ()=>{
        const side = Math.min(img.width, img.height);
        const sx = (img.width - side) / 2;
        const sy = (img.height - side) / 2;
        const canvas = document.createElement('canvas');
        canvas.width = size; canvas.height = size;
        const ctx = canvas.getContext('2d');
        ctx.fillStyle = '#ffffff';
        ctx.fillRect(0, 0, size, size);
        ctx.drawImage(img, sx, sy, side, side, 0, 0, size, size);
        resolve(canvas.toDataURL('image/jpeg', 0.85));
      };
      img.src = reader.result;
    };
    reader.readAsDataURL(file);
  });
}

async function uploadClubLogo(file){
  try{
    const dataUrl = await resizeImageFileToDataUrl(file, 128);
    await db.collection('clubs').doc(currentClub.id).update({ logo: dataUrl });
    currentClub.logo = dataUrl;
    showToast('Logo actualizado.');
    render();
  }catch(e){
    showToast('No se pudo subir esa imagen. Prueba con otra.');
  }
}

async function addCategoryToClub(rawName){
  const name = (rawName || '').trim();
  if(!name){ showToast('Escribe un nombre de categoría.'); return; }
  if(currentClub.categories.some(c => c.toLowerCase() === name.toLowerCase())){
    showToast('Esa categoría ya existe.'); return;
  }
  try{
    await db.collection('clubs').doc(currentClub.id).update({
      categories: firebase.firestore.FieldValue.arrayUnion(name),
    });
    currentClub.categories.push(name);
    CATEGORIES = currentClub.categories;
    showToast(`Categoría "${name}" añadida.`);
    render(); // refresca la cabecera (nueva pestaña) y el panel del club a la vez
  }catch(e){
    showToast('No se pudo añadir la categoría. Revisa tu conexión.');
  }
}

// Renombra una categoría. Como los partidos/jugadoras se guardan en un documento cuyo nombre
// depende del texto de la categoría, hay que MOVER ese documento al nuevo nombre para no perder
// nada (leer los datos viejos, guardarlos con el nombre nuevo, borrar el documento viejo).
async function renameCategoryInClub(oldName, rawNewName){
  const newName = (rawNewName || '').trim();
  if(!newName){ showToast('El nombre no puede quedar vacío.'); return false; }
  if(newName === oldName) return true; // no ha cambiado nada
  if(currentClub.categories.some(c => c.toLowerCase() === newName.toLowerCase() && c !== oldName)){
    showToast('Ya existe otra categoría con ese nombre.'); return false;
  }
  try{
    const oldRef = db.collection('clubs').doc(currentClub.id).collection('categories').doc(slugify(oldName));
    const newRef = db.collection('clubs').doc(currentClub.id).collection('categories').doc(slugify(newName));
    const oldDoc = await oldRef.get();
    if(oldDoc.exists && slugify(oldName) !== slugify(newName)){
      await newRef.set(oldDoc.data());
      await oldRef.delete();
    }
    const updatedCategories = currentClub.categories.map(c => c === oldName ? newName : c);
    await db.collection('clubs').doc(currentClub.id).update({ categories: updatedCategories });
    currentClub.categories = updatedCategories;
    CATEGORIES = updatedCategories;
    if(activeCategory === oldName) activeCategory = newName;
    showToast(`"${oldName}" ahora se llama "${newName}".`);
    return true;
  }catch(e){
    showToast('No se pudo renombrar la categoría. Revisa tu conexión.');
    return false;
  }
}

// Elimina una categoría ENTERA: su documento (partidos y jugadoras incluidos) y su entrada
// en la lista del club. Es irreversible, por eso siempre se pide confirmación antes de llamarla.
async function deleteCategoryFromClub(name){
  if(currentClub.categories.length <= 1){
    showToast('No puedes borrar la última categoría del club.'); return;
  }
  try{
    await db.collection('clubs').doc(currentClub.id).collection('categories').doc(slugify(name)).delete();
    const updatedCategories = currentClub.categories.filter(c => c !== name);
    await db.collection('clubs').doc(currentClub.id).update({ categories: updatedCategories });
    currentClub.categories = updatedCategories;
    CATEGORIES = updatedCategories;
    showToast(`Categoría "${name}" eliminada.`);
    if(activeCategory === name){
      activeCategory = updatedCategories[0];
      loadCategory(activeCategory);
    }
    modal = {type:'adminCategories', data:{}};
    render();
  }catch(e){
    showToast('No se pudo eliminar la categoría. Revisa tu conexión.');
  }
}

async function updateMemberRole(memberUid, newRole){
  try{
    await db.collection('clubs').doc(currentClub.id).collection('members').doc(memberUid).update({ role: newRole });
    showToast('Rol actualizado.');
    render(); // vuelve a pintar el panel con la lista al día
  }catch(e){
    showToast('No se pudo cambiar el rol.');
  }
}

function renderAdminCategoriesModal(box){
  box.innerHTML = `
    <h3>Panel de administrador</h3>
    <div class="auth-section-title" style="margin-top:6px;">Categorías del club</div>
    <div class="admin-cat-list">
      ${currentClub.categories.map(c => `
        <div class="admin-cat-row" data-orig="${escapeAttr(c)}">
          <input type="text" class="admin-cat-input" value="${escapeAttr(c)}">
          <button class="icon-btn admin-cat-save" title="Guardar nombre" type="button">💾</button>
          <button class="icon-btn admin-cat-del" title="Eliminar categoría" type="button">🗑</button>
        </div>
      `).join('')}
    </div>
    <div class="cat-row-input" style="margin-top:10px;">
      <input type="text" id="admin-new-cat-input" placeholder="Ej. Alevín">
      <button class="btn btn-ghost btn-small" id="admin-new-cat-add" type="button">Añadir</button>
    </div>
    <div class="modal-actions" style="margin-top:14px;">
      <button class="btn btn-ghost" id="admin-back">← Volver al club</button>
      <button class="btn btn-accent" id="admin-close">Cerrar</button>
    </div>
  `;
  box.querySelector('#admin-close').addEventListener('click', ()=>{ modal=null; render(); });
  box.querySelector('#admin-back').addEventListener('click', ()=>{ modal={type:'clubPanel', data:{}}; render(); });
  box.querySelectorAll('.admin-cat-save').forEach(btn=>{
    btn.addEventListener('click', async ()=>{
      const row = btn.closest('.admin-cat-row');
      const oldName = row.dataset.orig;
      const newName = row.querySelector('.admin-cat-input').value;
      const ok = await renameCategoryInClub(oldName, newName);
      if(ok) render();
    });
  });
  box.querySelectorAll('.admin-cat-del').forEach(btn=>{
    btn.addEventListener('click', ()=>{
      const row = btn.closest('.admin-cat-row');
      const name = row.dataset.orig;
      showConfirm(`¿Eliminar "${name}"? Se borrarán también todos sus partidos y jugadoras. Esto no se puede deshacer.`, ()=> deleteCategoryFromClub(name));
    });
  });
  const submitNew = ()=> addCategoryToClub(box.querySelector('#admin-new-cat-input').value);
  box.querySelector('#admin-new-cat-add').addEventListener('click', submitNew);
  box.querySelector('#admin-new-cat-input').addEventListener('keydown', (e)=>{ if(e.key==='Enter') submitNew(); });
}

function renderClubPanelModal(box){
  const isOwner = currentClub.myRole === 'owner';
  box.innerHTML = `<div class="empty">Cargando…</div>`;
  const membersPromise = isOwner
    ? db.collection('clubs').doc(currentClub.id).collection('members').get()
    : Promise.resolve(null);
  membersPromise.then(snap=>{
    const members = [];
    if(snap) snap.forEach(d=> members.push({ uid: d.id, ...d.data() }));
    box.innerHTML = `
      <h3>${escapeHtml(currentClub.name)}</h3>
      <div class="club-logo-row">
        ${currentClub.logo
          ? `<img src="${currentClub.logo}" class="club-logo-preview" alt="Logo del club">`
          : `<div class="club-logo-preview club-logo-placeholder">${escapeHtml((currentClub.name||'?').charAt(0).toUpperCase())}</div>`}
        ${isOwner ? `
          <div>
            <button class="btn btn-ghost btn-small" id="club-logo-btn" type="button">${currentClub.logo ? 'Cambiar logo' : 'Subir logo'}</button>
            <input type="file" accept="image/*" id="club-logo-input" style="display:none;">
          </div>
        ` : ''}
      </div>
      <div class="auth-section-title" style="margin-top:10px;">Código de invitación</div>
      <div class="invite-code-box">${escapeHtml(currentClub.code||'—')}</div>
      <div class="goal-log-summary" style="justify-content:center;">Compártelo con el resto del cuerpo técnico para que se unan a este club.</div>
      <div class="auth-section-title" style="margin-top:14px;">Categorías</div>
      <div class="club-cats-list">
        ${currentClub.categories.map(c=>`<span class="club-cat-chip">${escapeHtml(c)}</span>`).join('')}
      </div>
      <div class="auth-section-title" style="margin-top:14px;">Cuerpo técnico</div>
      ${isOwner ? `
        <div class="goal-log-list">
          ${members.map(m=>`
            <div class="goal-log-row member-row">
              <span class="goal-log-player">${escapeHtml(m.email||'')}</span>
              ${m.role==='owner'
                ? '<span class="goal-log-type">Propietario/a</span>'
                : `<select class="member-role-select" data-uid="${escapeAttr(m.uid)}">
                     <option value="coach" ${m.role!=='owner'?'selected':''}>Entrenador/a</option>
                     <option value="owner">Propietario/a</option>
                   </select>`}
            </div>
          `).join('')}
        </div>
      ` : `
        <p style="color:var(--muted);font-size:12.5px;">Solo el propietario/a del club puede ver quién tiene acceso.</p>
      `}
      <div class="modal-actions" style="margin-top:14px;">
        ${isOwner ? '<button class="btn btn-ghost" id="admin-open">⚙️ Panel de administrador</button>' : ''}
        ${userClubs.length>1 ? '<button class="btn btn-ghost" id="club-switch">Cambiar de club</button>' : ''}
        <button class="btn btn-ghost" id="club-logout">Cerrar sesión</button>
        <button class="btn btn-accent" id="club-panel-close">Cerrar</button>
      </div>
    `;
    box.querySelector('#club-panel-close').addEventListener('click', ()=>{ modal=null; render(); });
    box.querySelector('#club-logout').addEventListener('click', logOut);
    box.querySelectorAll('.member-role-select').forEach(sel=>{
      sel.addEventListener('change', ()=> updateMemberRole(sel.dataset.uid, sel.value));
    });
    const adminBtn = box.querySelector('#admin-open');
    if(adminBtn) adminBtn.addEventListener('click', ()=>{ modal={type:'adminCategories', data:{}}; render(); });
    const logoBtn = box.querySelector('#club-logo-btn');
    if(logoBtn) logoBtn.addEventListener('click', ()=> box.querySelector('#club-logo-input').click());
    const logoInput = box.querySelector('#club-logo-input');
    if(logoInput) logoInput.addEventListener('change', (e)=>{
      const file = e.target.files && e.target.files[0];
      if(file) uploadClubLogo(file);
    });
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