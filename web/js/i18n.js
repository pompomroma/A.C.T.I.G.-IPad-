// Bilingual (Korean/English) strings + helpers. Korean is the default "main"
// language; a UI toggle switches to English. This module is the single source of
// truth for every user-facing string, so app.js / voice.js / llm.js all read the
// current language from here.

const LANG_KEY = 'actig.lang';
let current = localStorage.getItem(LANG_KEY) || 'ko';

export function getLang(){ return current; }
export function setLang(l){ current = (l === 'en') ? 'en' : 'ko'; try{ localStorage.setItem(LANG_KEY, current); }catch{} }
export function toggleLang(){ setLang(current === 'ko' ? 'en' : 'ko'); return current; }

// True if the text contains Hangul (used as a fallback to pick a TTS voice / stub).
export function hasHangul(s){ return /[㄰-㆏가-힣]/.test(s || ''); }

const SHAPE_EN = { box:'box', sphere:'sphere', cylinder:'cylinder', cone:'cone', pyramid:'pyramid', torus:'torus', plane:'plane' };
const SHAPE_KO = { box:'정육면체', sphere:'구체', cylinder:'원기둥', cone:'원뿔', pyramid:'피라미드', torus:'도넛', plane:'평면' };

const STR = {
  en: {
    // UI labels
    'ui.title':'A.C.T.I.G.', 'ui.you':'You', 'ui.ai':'ACTIG',
    'ui.placeholder':'Command A.C.T.I.G.…', 'ui.scan':'◎ Scan object',
    'ui.boot':'Initializing A.C.T.I.G.…', 'ui.wakeHint':'tap or say “wake up ACTIG”',
    'ui.langToggle':'한국어',
    'tool.box':'▣ Box', 'tool.sphere':'◯ Sphere', 'tool.cylinder':'⬭ Cyl', 'tool.cone':'▲ Cone',
    'tool.grow':'＋ Grow', 'tool.shrink':'－ Shrink', 'tool.rotate':'⟳ Rotate', 'tool.delete':'🗑 Del',
    'tool.undo':'↶ Undo', 'tool.redo':'↷ Redo', 'tool.export':'⬇ Export',
    // statuses
    'st.dormant':'dormant', 'st.starting':'starting…', 'st.listening':'online · listening',
    'st.thinking':'thinking…', 'st.responding':'responding', 'st.listen':'listening',
    'st.transcribing':'transcribing…', 'st.typeToMe':'online · type to me',
    'st.goAhead':'go ahead — listening', 'st.warming':'warming up the model…',
    'st.loading':(p)=>`loading model… ${p}%`, 'st.liteRetry':'lite mode · tap to retry full model',
    'st.ready':(n)=>`full model ready · ${n}`, 'st.offlineStub':'ready (offline stub)',
    'st.retrying':'retrying full model…', 'st.listenLoading':'listening · full model loading…',
    // greeting + notes
    'welcome':'Welcome sir, ACTIG at your service sir, how may I assist you sir.',
    'warmNote':'  (quick reply, sir — my full model is still warming up.)',
    'voiceUnavailable':'Voice input is unavailable on this browser, sir — please type to me and I will still reply by voice.',
    // command acknowledgements
    'ack.openScene':'Opening the 3D project space, sir.',
    'ack.cameraDisabled':'Camera control disabled, sir.',
    'ack.undo':'Reverted, sir.', 'ack.redo':'Restored, sir.',
    'ack.added':(k)=>`Added a ${k}, sir.`, 'ack.created':(n,k)=>`Created ${n} ${k}s, sir.`,
    'ack.grow':'Enlarged, sir.', 'ack.shrink':'Shrunk, sir.', 'ack.rotate':'Rotated, sir.',
    'ack.move':'Moved, sir.', 'ack.moveTo':'Centred, sir.',
    'ack.delete':'Deleted, sir.', 'ack.swap':'Swapped positions, sir.', 'ack.clear':'Scene cleared, sir.',
    'ack.cantAnalyze':'I could not analyse that, sir.',
    'ack.handUnavailable':'Hand tracking is unavailable on this browser, sir.',
    'ack.handEnabled':'Camera hand control enabled, sir. Pinch to grab a shape and move it.',
    'ack.noCamera':'I could not access the camera, sir.',
    'ack.fileError':'I received the file, sir, but could not analyse it.',
    'ack.engineFail':'The 3D engine could not load, sir.',
    'st.analysing':'analysing…', 'scanQ':'What is this object?',
    'st.building':'modelling…',
    'ack.built':(d)=>`Built ${d}, sir.`, 'ack.approx':' (my interpretation — say "clear" to start over)',
    'ack.exported':'Exported the model, sir — actig-model.obj and actig-model.json.',
    'ack.nothingToExport':'There is nothing to export yet, sir.',
    'ack.imported':'Loaded the model, sir.',
  },
  ko: {
    'ui.title':'A.C.T.I.G.', 'ui.you':'사용자', 'ui.ai':'액티그',
    'ui.placeholder':'A.C.T.I.G.에게 명령하세요…', 'ui.scan':'◎ 사물 스캔',
    'ui.boot':'A.C.T.I.G. 초기화 중…', 'ui.wakeHint':'탭하거나 “액티그 일어나”라고 말하세요',
    'ui.langToggle':'EN',
    'tool.box':'▣ 정육면체', 'tool.sphere':'◯ 구체', 'tool.cylinder':'⬭ 원기둥', 'tool.cone':'▲ 원뿔',
    'tool.grow':'＋ 확대', 'tool.shrink':'－ 축소', 'tool.rotate':'⟳ 회전', 'tool.delete':'🗑 삭제',
    'tool.undo':'↶ 실행취소', 'tool.redo':'↷ 다시실행', 'tool.export':'⬇ 내보내기',
    'st.dormant':'대기 중', 'st.starting':'시작 중…', 'st.listening':'온라인 · 듣는 중',
    'st.thinking':'생각 중…', 'st.responding':'응답 중', 'st.listen':'듣는 중',
    'st.transcribing':'받아쓰는 중…', 'st.typeToMe':'온라인 · 입력해 주세요',
    'st.goAhead':'말씀하세요 — 듣고 있습니다', 'st.warming':'모델 준비 중…',
    'st.loading':(p)=>`모델 불러오는 중… ${p}%`, 'st.liteRetry':'라이트 모드 · 탭하여 전체 모델 재시도',
    'st.ready':(n)=>`전체 모델 준비됨 · ${n}`, 'st.offlineStub':'준비됨 (오프라인 라이트)',
    'st.retrying':'전체 모델 재시도 중…', 'st.listenLoading':'듣는 중 · 전체 모델 불러오는 중…',
    'welcome':'환영합니다 주인님, 액티그가 대기 중입니다. 무엇을 도와드릴까요?',
    'warmNote':'  (빠른 응답입니다 주인님 — 전체 모델을 아직 준비 중입니다.)',
    'voiceUnavailable':'이 브라우저에서는 음성 입력을 사용할 수 없습니다 주인님 — 입력해 주시면 음성으로 답변드리겠습니다.',
    'ack.openScene':'3D 프로젝트 공간을 엽니다 주인님.',
    'ack.cameraDisabled':'카메라 제어를 껐습니다 주인님.',
    'ack.undo':'되돌렸습니다 주인님.', 'ack.redo':'복원했습니다 주인님.',
    'ack.added':(k)=>`${k}을(를) 추가했습니다 주인님.`, 'ack.created':(n,k)=>`${k} ${n}개를 만들었습니다 주인님.`,
    'ack.grow':'확대했습니다 주인님.', 'ack.shrink':'축소했습니다 주인님.', 'ack.rotate':'회전했습니다 주인님.',
    'ack.move':'이동했습니다 주인님.', 'ack.moveTo':'가운데로 옮겼습니다 주인님.',
    'ack.delete':'삭제했습니다 주인님.', 'ack.swap':'위치를 바꿨습니다 주인님.', 'ack.clear':'장면을 비웠습니다 주인님.',
    'ack.cantAnalyze':'분석할 수 없었습니다 주인님.',
    'ack.handUnavailable':'이 브라우저에서는 손 추적을 사용할 수 없습니다 주인님.',
    'ack.handEnabled':'카메라 손 제어를 켰습니다 주인님. 손가락을 모아 도형을 잡고 움직이세요.',
    'ack.noCamera':'카메라에 접근할 수 없었습니다 주인님.',
    'ack.fileError':'파일을 받았지만 분석할 수 없었습니다 주인님.',
    'ack.engineFail':'3D 엔진을 불러올 수 없었습니다 주인님.',
    'st.analysing':'분석 중…', 'scanQ':'이 사물은 무엇입니까?',
    'st.building':'모델링 중…',
    'ack.built':(d)=>`${d}을(를) 만들었습니다 주인님.`, 'ack.approx':' (제 해석입니다 — "초기화"라고 하시면 다시 시작합니다)',
    'ack.exported':'모델을 내보냈습니다 주인님 — actig-model.obj 와 actig-model.json.',
    'ack.nothingToExport':'아직 내보낼 것이 없습니다 주인님.',
    'ack.imported':'모델을 불러왔습니다 주인님.',
  },
};

// Look up a key in the current language; values may be plain strings or functions.
export function t(key, ...params){
  const table = STR[current] || STR.en;
  const v = (key in table) ? table[key] : (STR.en[key] ?? key);
  return (typeof v === 'function') ? v(...params) : v;
}

export function shapeName(kind){ return (current === 'ko' ? SHAPE_KO : SHAPE_EN)[kind] || kind; }

// Apply translations to static DOM: [data-i18n] -> textContent, [data-i18n-ph] -> placeholder.
export function applyI18n(root = document){
  root.querySelectorAll('[data-i18n]').forEach((el) => { el.textContent = t(el.dataset.i18n); });
  root.querySelectorAll('[data-i18n-ph]').forEach((el) => { el.placeholder = t(el.dataset.i18nPh); });
  if (root === document) document.documentElement.lang = current;
}
