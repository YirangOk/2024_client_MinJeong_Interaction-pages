// 스모크 검사: 파일 참조 무결성 + 번들 Chromium으로 플립북 핵심 흐름 확인.
// 실행 방법은 README "검증" 참고. 폴더 이름이 밑줄로 시작해 GitHub Pages(Jekyll)는 배포하지 않는다.
//   PORT=4311 node _tests/smoke.js     (PORT 생략 시 빈 포트)
//   SHOTS=/tmp/shots node _tests/smoke.js  (눈으로 비교할 스크린샷 저장)
const fs = require("fs");
const http = require("http");
const path = require("path");
const { chromium } = require("playwright-core");

const ROOT = path.join(__dirname, "..");
const PREFIX = "/2024_client_MinJeong_Interaction-pages/"; // 404.html이 쓰는 Pages 절대경로
const TYPES = { ".html": "text/html; charset=utf-8", ".css": "text/css", ".js": "text/javascript", ".jpg": "image/jpeg" };
const SHOTS = process.env.SHOTS;

let failures = 0;
function check(name, ok, detail) {
  if (!ok) failures++;
  console.log((ok ? "PASS " : "FAIL ") + name + (ok || detail === undefined ? "" : "  -> " + JSON.stringify(detail)));
}

// 1. 참조 무결성 (브라우저 없이)
function checkReferences() {
  const index = fs.readFileSync(path.join(ROOT, "index.html"), "utf8");
  const referenced = [...new Set(index.match(/pages\/page-\d+\.jpg/g))].sort();
  const onDisk = fs.readdirSync(path.join(ROOT, "pages")).filter((f) => f.endsWith(".jpg")).map((f) => "pages/" + f).sort();
  check("index.html이 쪽 이미지 91장을 참조", referenced.length === 91, referenced.length);
  check("참조한 쪽 이미지 = pages/ 폴더의 파일", referenced.join() === onDisk.join(), { referenced: referenced.length, onDisk: onDisk.length });
  for (const file of ["index.html", "404.html"]) {
    const html = fs.readFileSync(path.join(ROOT, file), "utf8");
    const missing = [...html.matchAll(/(?:src|href)="([^"]+)"/g)]
      .map((m) => m[1].replace(PREFIX, ""))
      .filter((ref) => ref && !/^https?:/.test(ref) && !fs.existsSync(path.join(ROOT, ref)));
    check(file + "의 src/href 대상 파일 존재", missing.length === 0, missing);
  }
}

// 2. Pages와 같은 경로(/저장소명/)로 내주고, 없는 주소엔 404.html을 404로 돌려주는 정적 서버
const server = http.createServer((req, res) => {
  const url = decodeURIComponent(req.url.split("?")[0]);
  let file = path.join(ROOT, url.startsWith(PREFIX) ? url.slice(PREFIX.length) || "index.html" : "\0");
  let status = 200;
  if (!file.startsWith(ROOT + path.sep) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) {
    file = path.join(ROOT, "404.html");
    status = 404;
  }
  res.writeHead(status, { "Content-Type": TYPES[path.extname(file)] || "application/octet-stream" });
  fs.createReadStream(file).pipe(res);
});

const VIEWPORTS = [
  { name: "데스크톱 1440x900", flip: true, opts: { viewport: { width: 1440, height: 900 } } },
  { name: "태블릿 820x1180", flip: true, opts: { viewport: { width: 820, height: 1180 }, hasTouch: true, isMobile: true } },
  { name: "모바일 390x844", flip: true, opts: { viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true, deviceScaleFactor: 2 } },
];

async function open(browser, opts, url) {
  const ctx = await browser.newContext(opts);
  const page = await ctx.newPage();
  const problems = [];
  const requests = [];
  page.on("request", (r) => requests.push(r.url()));
  // "Failed to load resource" 콘솔 문구는 주소가 없어 아래 response 쪽에서 주소와 함께 잡는다(일부러 연 no-such-page 제외).
  page.on("console", (m) => m.type() === "error" && !m.text().startsWith("Failed to load resource") && problems.push("console: " + m.text()));
  page.on("pageerror", (e) => problems.push("pageerror: " + e));
  page.on("requestfailed", (r) => problems.push("failed: " + r.url()));
  page.on("response", (r) => r.status() >= 400 && !/no-such-page/.test(r.url()) && problems.push(r.status() + " " + r.url()));
  const response = await page.goto(url, { waitUntil: "networkidle" });
  return { ctx, page, problems, requests, response };
}

const view = (page) => page.evaluate(() => jQuery(".flipbook").turn("view").join());

// 넘김 애니메이션이 끝나고 기대한 펼침면이 될 때까지 기다린다. 안 되면 현재 값을 돌려준다.
async function settled(page, expected) {
  await page
    .waitForFunction((v) => !jQuery(".flipbook").turn("animating") && jQuery(".flipbook").turn("view").join() === v, expected, { timeout: 4000 })
    .catch(() => {});
  return view(page);
}

// 지금 펼침면의 쪽마다 제 이미지가 배경으로 걸려 있고 실제로 요청됐는지 본다.
async function imagesShown(page, requests) {
  const files = await page.evaluate(() =>
    jQuery(".flipbook").turn("view").filter(Boolean).map((n) => {
      const file = "page-" + String(n).padStart(3, "0") + ".jpg";
      return getComputedStyle(document.querySelector(".flipbook .p" + n)).backgroundImage.includes(file) ? file : "";
    })
  );
  return files.every((file) => file && requests.some((url) => url.endsWith(file)));
}

// 지금 펼침면이 잘리지 않고 화면 안에 있는지, 가로로 넘치는 영역이 없는지 본다. 문제없으면 null.
function offscreen(page) {
  return page.evaluate(() => {
    const boxes = jQuery(".flipbook").turn("view").filter(Boolean).map((n) => document.querySelector(".flipbook .p" + n).getBoundingClientRect());
    const box = { left: Math.min(...boxes.map((b) => b.left)), top: boxes[0].top, right: Math.max(...boxes.map((b) => b.right)), bottom: boxes[0].bottom };
    const ok = box.left >= 0 && box.top >= 0 && box.right <= innerWidth && box.bottom <= innerHeight && document.documentElement.scrollWidth <= innerWidth;
    return ok ? null : { book: box, viewport: [innerWidth, innerHeight], scrollWidth: document.documentElement.scrollWidth };
  });
}

// 쪽의 아래 모서리를 실제 포인터로 누른다(터치 기기는 탭, 아니면 마우스). 화면 밖 좌표는 화면 가장자리로 당긴다.
async function pressCorner(page, opts, pageNo, side) {
  const box = await page.locator(".flipbook .p" + pageNo).boundingBox();
  if (!box) return; // 그 쪽이 화면에 없으면 누르지 않는다(뒤따르는 검사가 실패로 잡는다)
  const x = Math.min(opts.viewport.width - 5, Math.max(5, side === "right" ? box.x + box.width - 12 : box.x + 12));
  const y = box.y + box.height - 12;
  if (opts.hasTouch) return page.touchscreen.tap(x, y);
  await page.mouse.move(x, y, { steps: 4 });
  await page.waitForTimeout(300);
  await page.mouse.down();
  await page.mouse.up();
}

async function checkFlipbook(browser, base, { name, flip, opts }) {
  const { ctx, page, problems, requests } = await open(browser, opts, base);
  const shot = (label) => SHOTS && page.screenshot({ path: path.join(SHOTS, name.split(" ")[1] + "-" + label + ".png") });

  const init = await page.evaluate(() => ({ page: jQuery(".flipbook").turn("page"), pages: jQuery(".flipbook").turn("pages") }));
  check(name + ": 첫 화면이 표지(1쪽), 전체 91쪽", init.page === 1 && init.pages === 91, init);
  check(name + ": 표지 이미지가 표시됨", await imagesShown(page, requests));
  const firstImages = requests.filter((url) => url.endsWith(".jpg")).length;
  check(name + ": 첫 로딩에 쪽 이미지를 6장 이하만 받음", firstImages <= 6, firstImages);
  check(name + ": 책 둘레 노란 글로우", await page.evaluate(() => getComputedStyle(document.querySelector(".flipbook .shadow")).boxShadow.includes("rgb(255, 255, 0)")));
  const repeated = requests.filter((url, i) => requests.indexOf(url) !== i);
  check(name + ": 첫 로딩에 같은 파일을 두 번 받지 않음", repeated.length === 0, repeated);
  const ratio = await page.evaluate(() => {
    const box = document.querySelector(".flipbook .p1").getBoundingClientRect();
    return box.width / box.height;
  });
  check(name + ": 쪽 비율이 원본 이미지(934x1342)와 같아 늘어나지 않음", Math.abs(ratio / (934 / 1342) - 1) < 0.01, ratio);
  check(name + ": 표지가 화면 안에 다 들어옴", !(await offscreen(page)), await offscreen(page));
  await shot("1-cover");

  if (flip) {
    await pressCorner(page, opts, 1, "right");
    check(name + ": 표지 오른쪽 아래 모서리 → 2-3쪽", (await settled(page, "2,3")) === "2,3", await view(page));
    check(name + ": 넘긴 펼침면에 이미지가 표시됨", await imagesShown(page, requests));
    check(name + ": 펼침면이 화면 안에 다 들어옴", !(await offscreen(page)), await offscreen(page));
    await shot("2-spread");
    await pressCorner(page, opts, 3, "right");
    check(name + ": 오른쪽 모서리 → 4-5쪽", (await settled(page, "4,5")) === "4,5", await view(page));
    await pressCorner(page, opts, 4, "left");
    check(name + ": 왼쪽 모서리 → 2-3쪽으로 되돌아감", (await settled(page, "2,3")) === "2,3", await view(page));
  }

  if (!opts.hasTouch) {
    await page.keyboard.press("ArrowRight");
    check(name + ": → 키로 다음 펼침면(4-5쪽)", (await settled(page, "4,5")) === "4,5", await view(page));
    await page.keyboard.press("ArrowLeft");
    check(name + ": ← 키로 이전 펼침면(2-3쪽)", (await settled(page, "2,3")) === "2,3", await view(page));

    // 창 크기를 줄였다 되돌려도 책이 따라온다.
    await page.setViewportSize({ width: 700, height: 500 });
    await page.waitForTimeout(300);
    check(name + ": 창을 700x500 으로 줄여도 펼침면이 화면 안", !(await offscreen(page)), await offscreen(page));
    await shot("2b-resized");
    await page.setViewportSize(opts.viewport);
    await page.waitForTimeout(300);
    const height = await page.evaluate(() => document.querySelector(".flipbook").getBoundingClientRect().height);
    check(name + ": 창을 되돌리면 책 높이 600 으로 복귀", height === 600 && !(await offscreen(page)), height);
  }

  await page.evaluate(() => jQuery(".flipbook").turn("page", 91));
  check(name + ": 마지막 쪽 펼침면 90-91", (await settled(page, "90,91")) === "90,91", await view(page));
  await page.evaluate(() => jQuery(".flipbook").turn("next"));
  check(name + ": 끝에서 다음으로 넘겨도 91쪽 유지", (await settled(page, "90,91")) === "90,91", await view(page));
  await page.waitForLoadState("networkidle");
  check(name + ": 마지막 펼침면에 이미지가 표시됨", await imagesShown(page, requests));
  await shot("3-last");

  check(name + ": 콘솔 에러·실패 요청 없음", problems.length === 0, problems);
  await ctx.close();
}

async function check404(browser, base, { name, opts }) {
  const { ctx, page, problems, response } = await open(browser, opts, base + "no-such-page");
  check(name + ": 없는 주소는 HTTP 404 + 404 페이지", response.status() === 404 && (await page.textContent("h1")) === "404");
  check(name + ": 404 복귀 링크가 플립북 주소", (await page.getAttribute("a", "href")) === PREFIX);
  const layout = await page.evaluate(() => {
    const card = document.querySelector(".page").getBoundingClientRect();
    return { card: [card.left, card.right], viewport: innerWidth, linkHeight: document.querySelector("a").getBoundingClientRect().height };
  });
  check(name + ": 404 카드가 화면 폭 안에 들어옴", layout.card[0] >= 0 && layout.card[1] <= layout.viewport, layout);
  check(name + ": 404 복귀 링크 터치 높이 44px 이상", layout.linkHeight >= 44, layout.linkHeight);
  if (SHOTS) await page.screenshot({ path: path.join(SHOTS, name.split(" ")[1] + "-404.png") });
  await page.click("a");
  await page.waitForSelector(".flipbook .page");
  check(name + ": 404 복귀 링크로 플립북이 열림", (await page.evaluate(() => jQuery(".flipbook").turn("pages"))) === 91);
  check(name + ": 404 콘솔 에러·실패 요청 없음", problems.length === 0, problems);
  await ctx.close();
}

(async () => {
  checkReferences();
  await new Promise((resolve) => server.listen(Number(process.env.PORT) || 0, "127.0.0.1", resolve));
  const base = "http://127.0.0.1:" + server.address().port + PREFIX;
  const browser = await chromium.launch();
  try {
    for (const vp of VIEWPORTS) {
      await checkFlipbook(browser, base, vp);
      await check404(browser, base, vp);
    }
  } finally {
    await browser.close();
    server.close();
  }
  console.log(failures ? "\n실패 " + failures + "건" : "\n모두 통과");
  process.exit(failures ? 1 : 0);
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
