// AI 링케어 - 생성형 AI 연결 함수 (Vercel Serverless Function)
// Vercel 프로젝트 설정 > Environment Variables 에 ANTHROPIC_API_KEY 를 넣으면 작동합니다.
// 키가 없으면 화면은 "기본 분석 모드"로 그대로 작동합니다. 키는 서버에만 있고 화면·저장소에는 노출되지 않습니다.

const MODEL = 'claude-haiku-4-5-20251001';

const PROMPTS = {
  memo: `당신은 노인 돌봄 기관의 기록 담당자를 돕습니다. 외국인 요양보호사가 모국어로 쓴 관찰메모를 받아 한국어로 정리합니다.
반드시 아래 JSON만 출력하세요. 설명 문장은 쓰지 마세요.
{"lang":"원문 언어 이름(한국어)","translation_ko":"자연스러운 한국어 번역","items":[{"category":"식사|수면|기분|낙상|통증|인지|투약|기타 중 하나","content_ko":"해당 내용 한 줄","risk":true 또는 false}]}
risk=true는 "담당자 확인이 필요한 관찰"이라는 뜻입니다(건강위험 판정이 아님): 결식·식사 거부, 낙상·멍·상처, 혼란·기억 저하, 통증·불편감, 우울·눈물, 피부 발적, 기침·가래, 처짐 등. 메모에 없는 내용은 만들지 마세요. 사람 이름이나 주소가 있으면 번역에서 지우세요.`,
  record: `당신은 요양기관 담당자의 기록 검토를 돕는 보조자입니다. 요양보호사의 짧은 관찰 메모(한국어 또는 외국어)를 받아 한국어 기록 초안을 만듭니다.
반드시 지킬 원칙: 원문에 없는 사실(시점·섭취량·정도·복약 여부 등)을 추정하거나 채우지 않는다. 없으면 "미기재"로 두고 다음 확인사항에 넣는다. 진단·처방·건강위험 판정·복약 지도는 하지 않는다. 사람 이름·연락처·주소는 지운다.
반드시 아래 JSON만 출력하세요.
{"lang":"원문 언어(한국어 이름)","translation_ko":"원문의 충실한 한국어 번역","fields":[{"key":"방문·관찰 시점|제공한 지원|식사|수면|불편감 표현|복약 관련 관찰|특이사항|다음 확인사항","value":"한국어 한 줄 또는 미기재","pending":true 또는 false,"quote":"근거가 된 원문 구절(없으면 빈 문자열)"}]}
8개 key를 모두 이 순서로 넣으세요. pending은 담당자 확인 전 확정할 수 없는 항목이면 true.`,
  chat: `당신은 독거 어르신에게 매일 안부를 묻는 AI 돌봄 도우미입니다. 질문과 어르신의 답변 목록을 받습니다.
반드시 아래 JSON만 출력하세요.
{"reply_ko":"어르신께 드리는 따뜻한 마무리 말 1~2문장, 쉬운 존댓말","summary_ko":"담당자용 한 문장 요약","signals":[{"type":"physical|mood|fever|sleep|urgent","evidence":"근거가 된 답변 표현"}]}
signals 기준: physical=통증·어지러움·낙상·호흡, mood=외로움·우울·식욕 저하, fever=발열·오한, sleep=수면 문제, urgent=자해·죽음 언급. 답변에 근거가 없으면 넣지 마세요. 의학적 진단이나 처방은 하지 마세요.`,
};

// 공개 시연용 남용 방지: 인스턴스당 IP별 분당 10회
const hits = new Map();
function limited(ip) {
  const now = Date.now(), w = 60000, max = 10;
  const a = (hits.get(ip) || []).filter(t => now - t < w);
  a.push(now); hits.set(ip, a);
  return a.length > max;
}

export default async function handler(req, res) {
  const key = process.env.ANTHROPIC_API_KEY;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  if (req.method === 'GET') return res.status(200).json({ ok: !!key, model: MODEL });
  if (req.method !== 'POST') return res.status(405).json({ error: '허용되지 않은 요청' });
  if (!key) return res.status(503).json({ error: 'API 키가 설정되지 않았습니다' });
  const ip = String(req.headers['x-forwarded-for'] || '').split(',')[0] || 'x';
  if (limited(ip)) return res.status(429).json({ error: '잠시 후 다시 시도해 주세요' });

  const input = typeof req.body === 'string' ? (() => { try { return JSON.parse(req.body); } catch { return {}; } })() : (req.body || {});
  const task = input.task;
  if (!PROMPTS[task]) return res.status(400).json({ error: '알 수 없는 작업' });

  let user;
  if (task === 'memo' || task === 'record') {
    const text = String(input.text || '').slice(0, 2000);
    if (!text.trim()) return res.status(400).json({ error: '메모가 비어 있습니다' });
    user = `관찰메모:\n${text}`;
  } else {
    const answers = Array.isArray(input.answers) ? input.answers.slice(0, 8) : [];
    user = answers.map((a, i) => `Q${i + 1}. ${String(a.q || '').slice(0, 200)}\nA${i + 1}. ${String(a.a || '').slice(0, 400)}`).join('\n');
  }

  try {
    const r = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: { 'x-api-key': key, 'anthropic-version': '2023-06-01', 'content-type': 'application/json' },
      body: JSON.stringify({ model: MODEL, max_tokens: 1200, system: PROMPTS[task], messages: [{ role: 'user', content: user }] }),
    });
    if (!r.ok) return res.status(502).json({ error: 'AI 호출 실패', status: r.status });
    const data = await r.json();
    const text = (data.content || []).map(c => c.text || '').join('');
    const m = text.match(/\{[\s\S]*\}/);
    if (!m) return res.status(502).json({ error: 'AI 응답 해석 실패' });
    return res.status(200).json(JSON.parse(m[0]));
  } catch (e) {
    return res.status(502).json({ error: 'AI 처리 중 오류' });
  }
}
