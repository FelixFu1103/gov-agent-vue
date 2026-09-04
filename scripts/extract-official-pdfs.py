from pathlib import Path
from urllib.request import Request, urlopen
import re
import sys

try:
    from pypdf import PdfReader
except ImportError as error:
    raise SystemExit("需要 pypdf：请使用 Codex workspace Python，或执行 python3 -m pip install pypdf") from error

ROOT = Path(__file__).resolve().parents[1]
PDF_DIR = ROOT / "tmp" / "pdfs"
OUTPUT_DIR = ROOT / "knowledge" / "documents"
PDF_DIR.mkdir(parents=True, exist_ok=True)

SOURCES = [
    {
        "id": "js-service-guide-2022",
        "title": "江苏省医疗保障经办政务服务事项办事指南（2022版）",
        "url": "https://ybj.jiangsu.gov.cn/module/download/downfile.jsp?classid=0&filename=da69f49e8d894dd7adbab8bc38384434.pdf",
        "notice": "https://ybj.jiangsu.gov.cn/art/2022/4/27/art_75671_10430132.html",
        "content_kind": "办事指南",
        "publication_date": "2022-04-27",
        "version_note": "江苏省医疗保障经办政务服务事项办事指南（2022版）；具体地方口径须结合最新政策核验",
    },
    {
        "id": "js-cross-region-rules-2022",
        "title": "江苏省异地就医经办服务规程",
        "url": "https://ybj.jiangsu.gov.cn/module/download/downfile.jsp?classid=0&filename=05c91c7ce17c4b4ba566585c879b69e4.pdf",
        "notice": "https://ybj.jiangsu.gov.cn/art/2022/12/9/art_76383_10702545.html",
        "content_kind": "经办规程",
        "publication_date": "2022-12-09",
        "version_note": "苏医保发〔2022〕75号，自2023年1月1日起施行",
    },
]


def download(url: str, target: Path) -> None:
    if target.exists() and target.stat().st_size > 10_000:
        return
    request = Request(url, headers={"User-Agent": "JiangsuMedicalInsuranceKnowledgeSync/1.0"})
    with urlopen(request, timeout=45) as response:
        target.write_bytes(response.read())


def clean_page(text: str) -> str:
    text = text.replace("\u3000", " ").replace("\r", "")
    lines = []
    for line in text.splitlines():
        value = re.sub(r"\s+", " ", line).strip()
        if not value or re.fullmatch(r"[-— ]*\d+[-— ]*", value):
            continue
        if value in {"江苏省医疗保障局", "江苏省医疗保障经办政务服务事项办事指南"}:
            continue
        lines.append(value)
    return "\n".join(lines).strip()


def write_markdown(source: dict, reader: PdfReader) -> tuple[str, int]:
    pages = []
    char_count = 0
    for index, page in enumerate(reader.pages, start=1):
        content = clean_page(page.extract_text() or "")
        if len(content) < 20:
            continue
        char_count += len(content)
        pages.append(f"## PDF第{index}页\n\n{content}")
    if char_count < 1_000:
        raise ValueError(f"PDF可提取正文过短：{source['url']}")
    header = f"""---
title: {source['title']}
department: 江苏省医疗保障局
region: 江苏省
service_code:
policy_level: 省级
content_kind: {source['content_kind']}
keywords: 江苏医保 医疗保障 经办服务 办事指南 政策原文
source: {source['notice']}
source_document: {source['url']}
verified_at: 2026-09-04
publication_date: {source['publication_date']}
priority: normal
version_note: {source['version_note']}
---
"""
    filename = f"official-{source['id']}.md"
    (OUTPUT_DIR / filename).write_text(header + "\n" + "\n\n".join(pages) + "\n", encoding="utf-8")
    return filename, char_count


results = []
for source in SOURCES:
    pdf_path = PDF_DIR / f"{source['id']}.pdf"
    download(source["url"], pdf_path)
    reader = PdfReader(str(pdf_path))
    filename, characters = write_markdown(source, reader)
    results.append((filename, len(reader.pages), characters))

for filename, pages, characters in results:
    print(f"{filename}: {pages} pages, {characters} characters")
