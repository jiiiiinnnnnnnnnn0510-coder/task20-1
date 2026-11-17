const PAGE_SIZE = 1000;
const CACHE_DURATION = 5 * 60 * 1000;

let cachedEvents = null;
let cachedAt = 0;

function jsonResponse(statusCode, data) {
  return {
    statusCode,
    headers: {
      "Content-Type": "application/json; charset=utf-8"
    },
    body: JSON.stringify(data)
  };
}

async function requestPage(apiKey, start, end) {
  const url =
    `http://openapi.seoul.go.kr:8088/` +
    `${encodeURIComponent(436154794c7373773737516c677742)}/json/culturalEventInfo/` +
    `${start}/${end}/`;

  const response = await fetch(url, {
    signal: AbortSignal.timeout(15000)
  });

  if (!response.ok) {
    throw new Error(`서울시 API HTTP 오류: ${response.status}`);
  }

  const data = await response.json();
  const service = data.culturalEventInfo;
  const result = service?.RESULT || data.RESULT;

  if (result?.CODE === "INFO-200") {
    return { total: 0, rows: [] };
  }

  if (result?.CODE && result.CODE !== "INFO-000") {
    throw new Error(
      `서울시 API 오류: ${result.CODE} / ${result.MESSAGE}`
    );
  }

  if (!service || !Array.isArray(service.row)) {
    throw new Error("서울시 API 응답 형식을 확인할 수 없습니다.");
  }

  const total = Number(service.list_total_count);

  if (!Number.isSafeInteger(total) || total < 0) {
    throw new Error("서울시 API의 전체 데이터 건수가 올바르지 않습니다.");
  }

  return {
    total,
    rows: service.row
  };
}

export async function handler(event) {
  if (event.httpMethod !== "GET") {
    return jsonResponse(405, {
      error: "GET 요청만 사용할 수 있습니다."
    });
  }

  const apiKey = process.env.SEOUL_API_KEY?.trim();

  if (!apiKey) {
    return jsonResponse(500, {
      error: "Netlify 환경변수 SEOUL_API_KEY를 설정한 뒤 다시 배포하세요."
    });
  }

  if (cachedEvents && Date.now() - cachedAt < CACHE_DURATION) {
    return jsonResponse(200, { events: cachedEvents });
  }

  try {
    const firstPage = await requestPage(apiKey, 1, PAGE_SIZE);
    const events = [...firstPage.rows];

    // 첫 1,000건에 없는 분야도 가져오기 위해 나머지 페이지를 조회한다.
    // 한 번에 최대 4개 요청을 보내 API 요청이 과도하게 몰리지 않게 한다.
    for (
      let batchStart = PAGE_SIZE + 1;
      batchStart <= firstPage.total;
      batchStart += PAGE_SIZE * 4
    ) {
      const requests = [];

      for (let offset = 0; offset < 4; offset++) {
        const start = batchStart + offset * PAGE_SIZE;

        if (start > firstPage.total) break;

        const end = Math.min(
          start + PAGE_SIZE - 1,
          firstPage.total
        );

        requests.push(requestPage(apiKey, start, end));
      }

      const pages = await Promise.all(requests);

      for (const page of pages) {
        events.push(...page.rows);
      }
    }

    cachedEvents = events;
    cachedAt = Date.now();

    return jsonResponse(200, { events });
  } catch (error) {
    console.error("문화행사 조회 실패:", error);

    return jsonResponse(502, {
      error:
        "문화행사 조회에 실패했습니다. " +
        "서울시 인증키와 API 상태를 확인하세요. " +
        error.message
    });
  }
}