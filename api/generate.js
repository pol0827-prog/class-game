// =============================================================
//  Vercel 서버리스 함수: Gemini(구글 AI 스튜디오)로 게임 문제 만들기
//  · 버셀 > Settings > Environment Variables 에
//      GEMINI_API_KEY = (구글 AI 스튜디오에서 받은 키)
//      GEMINI_MODEL   = gemini-2.5-flash   (선택, 비우면 기본값)
//  · 키는 서버에만 있고 학생·브라우저에는 절대 노출되지 않습니다.
// =============================================================

const SPEC = {
  emoji:    '{"items":[{"emoji":"이모지 2~5개 조합","answer":"정답(속담·사자성어·작품·개념)","hint":"분류 힌트"}]}',
  chosung:  '{"items":[{"chosung":"정답의 초성(띄어쓰기 유지)","answer":"정답 개념어","hint":"짧은 힌트"}]}',
  keyword:  '{"items":[{"answer":"핵심 개념","hints":["가장 어려운 힌트","...","가장 쉬운 힌트(정확히 5개)"]}]}',
  qa:       '{"items":[{"question":"짧은 퀴즈 문제","answer":"짧은 정답"}]}',
  balance:  '{"items":[{"a":"선택지 A","b":"선택지 B"}]}',
  poll:     '{"items":[{"question":"예측 질문","options":["선택지1","선택지2","..."],"answer":"정답 선택지 문자열(정답이 없으면 빈 문자열)"}]}',
  fermi:    '{"items":[{"question":"페르미 추정 질문","answer":"접근 힌트(계산 순서)"}]}',
  question: '{"items":[{"question":"가벼운 마음열기 질문"}]}',
  truths:   '{"items":[{"statements":["문장1","문장2","문장3"],"lie":"거짓 문장 번호 1~3"}]}',
  ox:       '{"items":[{"statement":"OX 문장","answer":"O 또는 X","explanation":"한 줄 해설"}]}',
  concept:  '{"items":[{"question":"설명할 개념","answer":"설명에 꼭 들어갈 핵심어 2~4개(쉼표)"}]}',
  song:     '{"items":[{"title":"노래 제목","hint":"가수"}]}',
  liar:     '{"items":[{"category":"카테고리","words":["제시어 10개"]}]}',
  kword:    '{"items":[{"answer":"2~3글자 낱말","hint":"짧은 뜻 힌트"}]}',
  check:    '{"items":[{"question":"이해도 확인 발문"}]}',
  keyword_from: '{"items":[{"answer":"개념(입력 그대로)","hints":["가장 어려운 힌트","...","가장 쉬운 힌트(정확히 5개)"]}]}',
  song_emoji:   '{"items":[{"emoji":"이모지 3~6개"}]}',
  class_emoji:  '{"items":[{"name":"이름(입력 그대로)","emoji":"이모지 3~5개"}]}',
};

const GUIDE = {
  emoji: '이모지만 보고 맞힐 수 있게. 너무 어렵지 않게.',
  chosung: '수업 주제의 핵심 개념어. 초성은 정확해야 함.',
  keyword: '힌트 5개는 어려운 것→쉬운 것 순서. 정답 단어를 힌트에 직접 쓰지 말 것.',
  qa: '10초 안에 말로 답할 수 있는 짧은 문제.',
  balance: '고등학생이 웃으며 고를 수 있는 양자택일. 마지막 1~2개는 수업 주제와 연결.',
  poll: '수업 전에 예측해 보게 하는 질문. 사실 확인이 가능한 것만 정답을 적고, 아니면 빈 문자열.',
  fermi: '정답이 없고 논리적으로 어림할 수 있는 질문.',
  question: '부담 없이 답할 수 있는 질문. 사생활·가정사·외모·성적을 캐묻지 않기.',
  truths: '선생님 시범용 예시 문장.',
  ox: '오늘 수업 복습용. 사실관계가 정확한 것만.',
  concept: '짝에게 30초 안에 설명할 수 있는 크기의 개념.',
  song: '고등학생이 알 만한 노래.',
  liar: '라이어 게임용. 각 카테고리마다 서로 헷갈릴 만큼 비슷한 제시어 10개. 수업 주제와 관련된 카테고리 위주.',
  kword: '꼬들(한글 워들) 정답용 2~3글자 명사. 수업 주제의 개념어 위주, 띄어쓰기 없음.',
  check: '수업 마무리에 학생이 🟢🟡🔴로 답할 수 있는 "~할 수 있나요?" 형태의 짧은 이해도 확인 발문.',
  keyword_from: '아래 [자료]의 개념마다 힌트 5개. 자료 내용에 근거하고, 어려운 것(추상적 특징)→쉬운 것(대표 예시·결정적 단서) 순서. 정답 낱말을 힌트에 절대 쓰지 말 것. 개념 수만큼 만들 것.',
  song_emoji: '아래 [자료]의 노래 가사에서 핵심 장면·사물·감정을 골라 순서대로 이모지 3~6개로 표현. 가사 문장이나 제목 글자는 출력하지 말고 이모지만. 제목을 그대로 그린 것보다 가사 내용을 반영할 것.',
  class_emoji: '아래 [자료]의 학생마다 특징을 이모지 3~5개로 표현해 친구들이 맞히는 퀴즈를 만든다. 긍정적이고 재미있게, 놀림·외모·성적·가정에 관한 표현 금지. 이름 글자는 이모지에 넣지 말 것. 학생 수만큼 만들 것.',
};

module.exports = async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST만 가능합니다.' });

  const key = process.env.GEMINI_API_KEY;
  if (!key) return res.status(500).json({ error: '버셀 환경변수 GEMINI_API_KEY가 설정되지 않았어요.' });

  let body = req.body;
  if (typeof body === 'string') { try { body = JSON.parse(body); } catch { body = {}; } }
  const { format, topic = '', grade = '고1', count = 8, level = '보통', extra = '', subject = '국어', game = '', source = '' } = body || {};
  if (!SPEC[format]) return res.status(400).json({ error: '지원하지 않는 형식입니다.' });

  const n = Math.max(1, Math.min(40, parseInt(count, 10) || 8));
  const prompt = [
    `너는 한국 고등학교 ${subject} 교사를 돕는 수업 게임 출제자다.`,
    `게임: ${game}`,
    `대상: ${grade}, 난이도: ${level}`,
    `오늘 수업 주제: ${String(topic).slice(0, 200) || '(자유 주제)'}`,
    extra ? `추가 요청: ${String(extra).slice(0, 300)}` : '',
    source ? `[자료]\n${String(source).slice(0, 4000)}\n[자료 끝]` : '',
    `조건: ${GUIDE[format]}`,
    '모든 내용은 사실에 맞아야 하며, 학생에게 부적절한 내용은 넣지 않는다. 한국어로 쓴다.',
    `정확히 ${n}개를 만들어 아래 JSON 형식으로만 답하라. 다른 말은 쓰지 마라.`,
    SPEC[format],
  ].filter(Boolean).join('\n');

  const model = process.env.GEMINI_MODEL || 'gemini-2.5-flash';
  try {
    const r = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-goog-api-key': key },
      body: JSON.stringify({
        contents: [{ role: 'user', parts: [{ text: prompt }] }],
        generationConfig: { responseMimeType: 'application/json', temperature: 0.9 },
      }),
    });
    const data = await r.json();
    if (!r.ok) return res.status(502).json({ error: data?.error?.message || 'Gemini 호출 실패' });
    const text = data?.candidates?.[0]?.content?.parts?.map(p => p.text || '').join('') || '';
    let parsed;
    try { parsed = JSON.parse(text); } catch {
      const m = text.match(/\{[\s\S]*\}/); parsed = m ? JSON.parse(m[0]) : null;
    }
    const items = Array.isArray(parsed) ? parsed : parsed?.items;
    if (!Array.isArray(items)) return res.status(502).json({ error: 'AI 응답을 해석하지 못했어요. 다시 시도해 주세요.' });
    return res.status(200).json({ items });
  } catch (e) {
    return res.status(500).json({ error: String(e.message || e) });
  }
};
