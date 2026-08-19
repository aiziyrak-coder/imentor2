"""Tashqi ilmiy adabiyot qidiruvi: PubMed (E-utilities) va Semantic Scholar.

MUHIM QOIDA: bu modul faqat API'dan REAL qaytgan natijalarni qaytaradi.
LLM hech qachon PMID/DOI/link o'ylab topmasligi kerak — havolalar shu yerda,
haqiqiy API javobidan yig'iladi va keyin promptga "manba" sifatida beriladi.
Ikkala API ham bepul va API key talab qilmaydi (PubMed'da key bo'lsa limit
yuqoriroq bo'ladi, lekin key'siz ham ishlaydi).
"""

from __future__ import annotations

import logging
import re
import xml.etree.ElementTree as ET

import requests

logger = logging.getLogger(__name__)

_PUBMED_ESEARCH = "https://eutils.ncbi.nlm.nih.gov/entrez/eutils/esearch.fcgi"
_PUBMED_ESUMMARY = "https://eutils.ncbi.nlm.nih.gov/entrez/eutils/esummary.fcgi"
_PUBMED_EFETCH = "https://eutils.ncbi.nlm.nih.gov/entrez/eutils/efetch.fcgi"
_SEMANTIC_SCHOLAR = "https://api.semanticscholar.org/graph/v1/paper/search"
_WIKIPEDIA_SEARCH = "https://en.wikipedia.org/w/api.php"

_TIMEOUT = 8.0


def search_wikipedia(query: str, limit: int = 3) -> list[dict]:
    """Wikipedia'dan (inglizcha) mavzuga oid maqolalarni topadi — umumiy
    tushuntirish/kontekst uchun foydali, real va doim ochiladigan havola
    bilan (https://en.wikipedia.org/wiki/...). Key talab qilmaydi. Xato
    bo'lsa bo'sh ro'yxat qaytadi."""
    query = (query or "").strip()
    if not query:
        return []
    try:
        resp = requests.get(
            _WIKIPEDIA_SEARCH,
            params={
                "action": "query",
                "list": "search",
                "srsearch": query,
                "srlimit": max(1, min(limit, 6)),
                "format": "json",
                "srprop": "snippet",
            },
            headers={"User-Agent": "iMentor-education-ai/1.0"},
            timeout=_TIMEOUT,
        )
        resp.raise_for_status()
        results = ((resp.json().get("query") or {}).get("search")) or []
        out: list[dict] = []
        for item in results:
            title = str(item.get("title") or "").strip()
            if not title:
                continue
            snippet = re_sub_html(str(item.get("snippet") or ""))
            page_slug = title.replace(" ", "_")
            out.append(
                {
                    "type": "wikipedia",
                    "title": title,
                    "authors": "",
                    "year": "",
                    "abstract": snippet[:800],
                    "url": f"https://en.wikipedia.org/wiki/{page_slug}",
                }
            )
        return out
    except Exception:
        logger.warning("Wikipedia qidiruv xato (query=%r)", query, exc_info=True)
        return []


def re_sub_html(text: str) -> str:
    """Wikipedia snippet'idagi <span class="searchmatch">...</span> kabi
    HTML teglarini tozalaydi."""
    import re as _re

    return _re.sub(r"<[^>]+>", "", text)


_CORE_JOURNALS = (
    '"Lancet"[Journal] OR "N Engl J Med"[Journal] OR "JAMA"[Journal] OR "BMJ"[Journal] OR '
    '"Cochrane Database Syst Rev"[Journal] OR "Nat Med"[Journal] OR "Ann Intern Med"[Journal] OR '
    '"Circulation"[Journal] OR "Eur Heart J"[Journal] OR "Thorax"[Journal] OR "Chest"[Journal] OR '
    "Review[Publication Type] OR Guideline[Publication Type]"
)


def search_pubmed(query: str, retmax: int = 5, *, prefer_core: bool = False) -> list[dict]:
    """PubMed'dan mavzuga oid maqolalarni topib, sarlavha/muallif/yil/abstrakt
    bilan qaytaradi. Har biri haqiqiy `https://pubmed.ncbi.nlm.nih.gov/{pmid}/`
    havolasiga ega. Xato/timeout bo'lsa bo'sh ro'yxat qaytadi (generatsiya
    to'xtab qolmasligi uchun)."""
    query = (query or "").strip()
    if not query:
        return []
    if prefer_core:
        core = search_pubmed(f"({query}) AND ({_CORE_JOURNALS})", retmax=retmax, prefer_core=False)
        if len(core) >= 3:
            return core[: max(1, min(retmax, 10))]
        extra = search_pubmed(query, retmax=retmax, prefer_core=False)
        return dedupe_external_sources(core + extra)[: max(1, min(retmax, 10))]
    try:
        search_resp = requests.get(
            _PUBMED_ESEARCH,
            params={
                "db": "pubmed",
                "term": query,
                "retmax": max(1, min(retmax, 10)),
                "retmode": "json",
                "sort": "relevance",
            },
            timeout=_TIMEOUT,
        )
        search_resp.raise_for_status()
        esearchresult = search_resp.json().get("esearchresult") or {}
        id_list = esearchresult.get("idlist") or []
        if not id_list:
            return []
        # Agar so'rov so'zlarining aksariyati PubMed lug'atida topilmagan bo'lsa
        # (masalan tarjima qilinmagan o'zbek/rus so'zlar), natijalar tasodifiy/
        # aloqasiz bo'lishi mumkin — bunday holda hech narsa qaytarmagan afzal.
        not_found = ((esearchresult.get("errorlist") or {}).get("phrasesnotfound")) or []
        query_terms = [t for t in query.split() if t]
        if query_terms and len(not_found) >= max(1, len(query_terms) - 1):
            logger.warning("PubMed: qidiruv so'zlarining aksariyati topilmadi (query=%r) — bekor qilindi", query)
            return []

        summary_resp = requests.get(
            _PUBMED_ESUMMARY,
            params={"db": "pubmed", "id": ",".join(id_list), "retmode": "json"},
            timeout=_TIMEOUT,
        )
        summary_resp.raise_for_status()
        summary_data = summary_resp.json().get("result") or {}

        abstracts: dict[str, str] = {}
        try:
            fetch_resp = requests.get(
                _PUBMED_EFETCH,
                params={"db": "pubmed", "id": ",".join(id_list), "rettype": "abstract", "retmode": "xml"},
                timeout=_TIMEOUT,
            )
            fetch_resp.raise_for_status()
            root = ET.fromstring(fetch_resp.text)
            for article in root.findall(".//PubmedArticle"):
                pmid_el = article.find(".//PMID")
                if pmid_el is None or not pmid_el.text:
                    continue
                abst_parts = [
                    "".join(el.itertext()).strip()
                    for el in article.findall(".//Abstract/AbstractText")
                ]
                abstracts[pmid_el.text.strip()] = " ".join(p for p in abst_parts if p)
        except Exception:
            logger.warning("PubMed efetch (abstract) xato — abstraktsiz davom etiladi", exc_info=True)

        out: list[dict] = []
        for pmid in id_list:
            item = summary_data.get(pmid) or {}
            title = str(item.get("title") or "").strip().rstrip(".")
            if not title:
                continue
            authors = ", ".join(
                a.get("name", "") for a in (item.get("authors") or [])[:3] if a.get("name")
            )
            pubdate = str(item.get("pubdate") or "").strip()
            year = pubdate[:4] if pubdate[:4].isdigit() else ""
            journal = str(item.get("fulljournalname") or item.get("source") or "").strip()
            out.append(
                {
                    "type": "pubmed",
                    "title": title,
                    "authors": authors,
                    "year": year,
                    "journal": journal,
                    "abstract": abstracts.get(pmid, "")[:1200],
                    "pmid": pmid,
                    "url": f"https://pubmed.ncbi.nlm.nih.gov/{pmid}/",
                }
            )
        return out
    except Exception:
        logger.warning("PubMed qidiruv xato (query=%r)", query, exc_info=True)
        return []


def search_semantic_scholar(query: str, limit: int = 5) -> list[dict]:
    """Semantic Scholar'dan mavzuga oid maqolalarni topadi — kengroq qamrov,
    ko'pincha DOI/ochiq matn havolasi bilan. Xato bo'lsa bo'sh ro'yxat."""
    query = (query or "").strip()
    if not query:
        return []
    try:
        resp = requests.get(
            _SEMANTIC_SCHOLAR,
            params={
                "query": query,
                "limit": max(1, min(limit, 10)),
                "fields": "title,abstract,year,authors,externalIds,url",
            },
            headers={"User-Agent": "iMentor-education-ai/1.0"},
            timeout=_TIMEOUT,
        )
        resp.raise_for_status()
        data = resp.json().get("data") or []
        out: list[dict] = []
        for item in data:
            title = str(item.get("title") or "").strip()
            if not title:
                continue
            authors = ", ".join(
                a.get("name", "") for a in (item.get("authors") or [])[:3] if a.get("name")
            )
            ext_ids = item.get("externalIds") or {}
            doi = str(ext_ids.get("DOI") or "").strip()
            url = str(item.get("url") or "").strip()
            if not url and doi:
                url = f"https://doi.org/{doi}"
            if not url:
                continue
            out.append(
                {
                    "type": "scholar",
                    "title": title,
                    "authors": authors,
                    "year": str(item.get("year") or ""),
                    "abstract": str(item.get("abstract") or "")[:1200],
                    "doi": doi,
                    "url": url,
                }
            )
        return out
    except requests.exceptions.HTTPError as e:
        # Semantic Scholar'ning bepul (API key'siz) darajasi umumiy IP bo'yicha
        # juda tez limitga uriladi (429) — bu KUTILGAN holat, xato emas. Bunday
        # holda shunchaki kitob/PubMed manbalari bilan davom etiladi, generatsiya
        # to'xtamaydi. To'liq traceback bilan "xato" deb log qilinmaydi.
        status = e.response.status_code if e.response is not None else None
        if status == 429:
            logger.info("Semantic Scholar: rate limit (429) — bu safar o'tkazib yuborildi (query=%r)", query)
        else:
            logger.warning("Semantic Scholar qidiruv xato (query=%r)", query, exc_info=True)
        return []
    except Exception:
        logger.warning("Semantic Scholar qidiruv xato (query=%r)", query, exc_info=True)
        return []


def dedupe_external_sources(sources: list[dict]) -> list[dict]:
    """PubMed va Semantic Scholar natijalari orasidagi takrorlarni (bir xil
    DOI yoki juda o'xshash sarlavha) olib tashlaydi."""
    seen_keys: set[str] = set()
    out: list[dict] = []
    for s in sources:
        key = str(s.get("pmid") or s.get("doi") or "").strip().lower()
        if not key:
            key = "title:" + " ".join(str(s.get("title") or "").lower().split())[:80]
        if key in seen_keys:
            continue
        seen_keys.add(key)
        out.append(s)
    return out
