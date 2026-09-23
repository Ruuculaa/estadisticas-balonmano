// app-core.js: constantes, Firebase, persistencia, confirmaciones/avisos
// TEAM_NAME y CATEGORIES ya NO son fijos: se rellenan al entrar en un club (ver app-auth.js)
let TEAM_NAME = '';
let CATEGORIES = [];
let currentClub = null; // {id, name, categories, code, role} — el club en el que se ha entrado
const POSITIONS = ['Portero','Lateral izq.','Lateral der.','Central','Extremo izq.','Extremo der.','Pivote'];
const STORE_KEY = 'balonmano-db';

// Cada stat es un lanzamiento o accion durante el partido.
// Las jugadoras de campo anotan goles; las porteras (posicion "Portero") registran paradas en su lugar;
// los entrenadores/as (role:'entrenador') solo registran sanciones disciplinarias.
const STAT_FIELDS_OUTFIELD = [
  {key:'goles6m', label:'Gol 6m'},
  {key:'fallos6m', label:'Fallo 6m'},
  {key:'goles9m', label:'Gol 9m'},
  {key:'fallos9m', label:'Fallo 9m'},
  {key:'penaltis', label:'Penalti'},
  {key:'fallosPenalti', label:'Fallo penalti'},
  {key:'contraataques', label:'Contra'},
  {key:'fallosContra', label:'Fallo contra'},
  {key:'amarillas', label:'Amarilla'},
  {key:'rojas', label:'Roja'},
  {key:'recuperaciones', label:'Recup.'},
  {key:'perdidas', label:'Pérdida'},
  {key:'exclusiones', label:"Exclus. 2'"},
];

const STAT_FIELDS_GK = [
  {key:'paradas6m', label:'Parada 6m'},
  {key:'paradas9m', label:'Parada 9m'},
  {key:'paradasPenalti', label:'Parada pen.'},
  {key:'paradasContra', label:'Parada contra'},
  {key:'amarillas', label:'Amarilla'},
  {key:'rojas', label:'Roja'},
  {key:'recuperaciones', label:'Recup.'},
  {key:'perdidas', label:'Pérdida'},
  {key:'exclusiones', label:"Exclus. 2'"},
];

const STAT_FIELDS_COACH = [
  {key:'amarillas', label:'Amarilla'},
  {key:'exclusiones', label:"Exclus. 2'"},
  {key:'rojas', label:'Roja'},
];

function getStatFields(p){
  if(p && p.role === 'entrenador') return STAT_FIELDS_COACH;
  return (p && p.position === 'Portero') ? STAT_FIELDS_GK : STAT_FIELDS_OUTFIELD;
}

// Todas las claves posibles combinadas (para el ranking de temporada y la exportacion a Excel)
const ALL_STAT_FIELDS = [
  ...STAT_FIELDS_OUTFIELD.filter(f=>!['amarillas','rojas','recuperaciones','perdidas','exclusiones'].includes(f.key)),
  ...STAT_FIELDS_GK.filter(f=>!['amarillas','rojas','recuperaciones','perdidas','exclusiones'].includes(f.key)),
  {key:'amarillas', label:'Amarilla'},
  {key:'rojas', label:'Roja'},
  {key:'recuperaciones', label:'Recup.'},
  {key:'perdidas', label:'Pérdida'},
  {key:'exclusiones', label:"Exclus. 2'"},
];

// Estadisticas que cuentan como gol anotado (jugadoras de campo), parada (porteras) o sancion (cualquiera)
const GOAL_KEYS = ['goles6m','goles9m','penaltis','contraataques'];
const GOAL_LABELS = {goles6m:'Gol 6m', goles9m:'Gol 9m', penaltis:'Penalti', contraataques:'Contra'};
const SAVE_KEYS = ['paradas6m','paradas9m','paradasPenalti','paradasContra'];
const SANCTION_KEYS = ['amarillas','exclusiones','rojas'];

function sortRoster(list){
  return [...list].sort((a,b)=>{
    const aCoach = a.role === 'entrenador', bCoach = b.role === 'entrenador';
    if(aCoach !== bCoach) return aCoach ? 1 : -1;
    if(aCoach) return a.name.localeCompare(b.name);
    return (a.number||0) - (b.number||0);
  });
}


let state = null;
let view = 'partidos'; // partidos | jugadores | resumen
let activeCategory = null; // se fija al entrar en un club, ver app-auth.js
let catScrollLeft = 0; // posicion del scroll horizontal de categorias, se restaura en cada repintado
let mainScrollTop = 0; // posicion del scroll vertical del contenido, se restaura en cada repintado
let theme = 'dark'; // 'dark' | 'light', preferencia personal
let openMatchId = null;
let pistaMatchId = null; // navegacion local de la pestaña Pista, no se comparte
let pistaSelScrollLeft = 0; // posicion del scroll del selector de partido en Pista
let modal = null;
let sortStat = 'totalGoles';
let sortScrollLeft = 0; // posicion del scroll de filtros de Resumen, se restaura en cada repintado
let toastTimer = null;

function uid(){ return Math.random().toString(36).slice(2,10) + Date.now().toString(36); }

function defaultState(){
  return { players: [], matches: [] };
}

// ============================================================
// CONFIGURACIÓN DE FIREBASE — PEGA AQUÍ TUS DATOS
// Este proyecto usa un Firebase PROPIO, separado del de CHMartorell (para que crezca sin
// límites compartidos ni afectar a esa app). Crea un proyecto nuevo y gratuito en
// https://console.firebase.google.com, añade una "app web" dentro, y pega aquí los datos
// que te da (Configuración del proyecto → tus apps → SDK setup and configuration).
// ============================================================
const firebaseConfig = {
  apiKey: "AIzaSyBs69h_n8qjJ6SWWFft07JOY38JtIH2_Dk",
  authDomain: "balonmano-stats-7898a.firebaseapp.com",
  projectId: "balonmano-stats-7898a",
  storageBucket: "balonmano-stats-7898a.firebasestorage.app",
  messagingSenderId: "351288563472",
  appId: "1:351288563472:web:4c8443bd775d2fdd0b3795"
};
// ============================================================

let db = null;
let auth = null;
let firebaseReady = false;
try{
  if(firebaseConfig.apiKey === "TU_API_KEY"){
    throw new Error("Falta configurar Firebase");
  }
  firebase.initializeApp(firebaseConfig);
  db = firebase.firestore();
  auth = firebase.auth();
  firebaseReady = true;
}catch(e){
  firebaseReady = false;
}

// Cada categoría de cada club tiene su propio documento de Firestore, dentro del club:
// clubs/{clubId}/categories/{categoria-en-minusculas}. Así cada documento se queda pequeño
// para siempre, sin acercarse al límite de 1 MB, y los datos de cada club quedan separados.
function slugify(text){
  return text.toLowerCase()
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/(^-|-$)/g, '');
}
function docRefFor(category){
  return db.collection('clubs').doc(currentClub.id).collection('categories').doc(slugify(category));
}

let unsubscribeCategory = null;

function persistTheme(){
  try{ localStorage.setItem('bm-theme', theme); }catch(e){}
}

function loadTheme(){
  try{
    const saved = localStorage.getItem('bm-theme');
    if(saved==='light' || saved==='dark') theme = saved;
  }catch(e){}
  applyTheme();
}

async function loadCategory(category){
  if(unsubscribeCategory){ unsubscribeCategory(); unsubscribeCategory = null; }

  // Vacía la vista al instante para no mostrar datos de la categoría anterior mientras carga la nueva
  state = defaultState();
  render();

  if(!firebaseReady || firebaseConfig.apiKey === "TU_API_KEY"){
    state = defaultState();
    render();
    showToast('Falta configurar Firebase: sustituye firebaseConfig en el código.');
    return;
  }

  const ref = docRefFor(category);
  try{
    const doc = await ref.get();
    if(doc.exists && doc.data().json){
      state = JSON.parse(doc.data().json);
    } else {
      state = defaultState();
      await ref.set({ json: JSON.stringify(state) });
    }
  }catch(e){
    state = defaultState();
    showToast('No se pudo conectar con Firebase. Revisa la configuración y las reglas.');
  }
  if(!state.players) state.players = [];
  if(!state.matches) state.matches = [];
  render();

  // Escucha cambios en tiempo real de otros entrenadores conectados a esta misma categoría
  unsubscribeCategory = ref.onSnapshot(doc=>{
    if(saveTimer){ return; } // hay un guardado local pendiente: no lo pisamos con datos remotos que aún no lo incluyen
    if(doc.exists && doc.data().json){
      const remote = JSON.parse(doc.data().json);
      if(JSON.stringify(remote) !== JSON.stringify(state)){
        state = remote;
        if(!state.players) state.players = [];
        if(!state.matches) state.matches = [];
        render();
      }
    }
  });
}

let saveTimer = null;
function saveState(){
  if(!firebaseReady) return;
  const ref = docRefFor(activeCategory);
  clearTimeout(saveTimer);
  saveTimer = setTimeout(async ()=>{
    try{
      await ref.set({ json: JSON.stringify(state) });
    }catch(e){
      showToast('No se pudo guardar. Revisa tu conexión.');
    }
  }, 250);
}

function showConfirm(message, onConfirm){
  modal = {type:'confirm', data:{message, onConfirm}};
  render();
}

function showToast(msg){
  clearTimeout(toastTimer);
  const existing = document.querySelector('.toast');
  if(existing) existing.remove();
  const t = document.createElement('div');
  t.className = 'toast';
  t.textContent = msg;
  document.body.appendChild(t);
  toastTimer = setTimeout(()=>t.remove(), 2400);
}