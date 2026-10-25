// app.html + engine.js → ../index.html (배포용 완전한 문서)
const fs = require('fs');
const path = require('path');
const dir = __dirname;
const app = fs.readFileSync(path.join(dir, 'app.html'), 'utf8');
const engine = fs.readFileSync(path.join(dir, 'engine.js'), 'utf8');
const body = app.replace('/*__ENGINE__*/', () => engine);

const full = `<!doctype html>
<html lang="ko">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<meta name="description" content="AI 링케어: 스마트링 생체신호와 AI 안부대화를 교차검증하는 독거 어르신 돌봄 시제품">
</head>
<body>
${body}
</body>
</html>
`;
fs.writeFileSync(path.join(dir, '..', 'index.html'), full);
console.log('built', full.length, 'bytes');
