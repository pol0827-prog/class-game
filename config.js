// =============================================================
//  설정 파일 — 배포할 때 이 파일만 고치면 됩니다.
// =============================================================
export const CONFIG = {
  // ① 파이어베이스 콘솔 > 프로젝트 설정 > 내 앱(웹 </>) 에서 복사한 값을 붙여 넣으세요.
  //    비워 두면(null) '이 기기에서만' 동작하는 체험 모드로 실행됩니다.
  //    (체험 모드: 같은 컴퓨터의 다른 탭에서만 학생 화면이 연결됨)
  firebase: {
    apiKey: "AIzaSyAz-sclG3AVIOp8fJrrH4KdSrUbj05Nzag",
    authDomain: "class-game-bdead.firebaseapp.com",
    projectId: "class-game-bdead",
    storageBucket: "class-game-bdead.firebasestorage.app",
    messagingSenderId: "39225772466",
    appId: "1:39225772466:web:d51d0ddd38c349ae36bcab"
  },
  /* 예시
  firebase: {
    apiKey: "AIza....",
    authDomain: "class-opener.firebaseapp.com",
    projectId: "class-opener",
    storageBucket: "class-opener.appspot.com",
    messagingSenderId: "1234567890",
    appId: "1:1234567890:web:abcdef"
  },
  */

  // ② AI 문제 만들기 주소 (버셀에 올리면 자동으로 동작, 키는 버셀 환경변수 GEMINI_API_KEY)
  aiEndpoint: '/api/generate',

  // ③ 학생 접속 주소 (비워 두면 현재 주소를 자동 사용)
  //    예: 'https://class-opener.vercel.app'
  publicUrl: 'https://class-game-gilt.vercel.app',
};
