# Sentry Google Enrichment Dashboard

This dashboard tracks Google Places requests made by enrichment.

## Primary Source: Spans

Every outbound Google Places request is wrapped in a Sentry span:

```text
span.op = http.client
span.description/name = Google Places nearby_search | Google Places text_search | Google Places place_details
provider = google_places
source = enrichment
endpoint = nearby_search | text_search | place_details
method = POST | GET
http.request.method = POST | GET
server.address = places.googleapis.com
url.scheme = https
status = success | error
```

## Suggested Widgets

Create a dashboard in Sentry with these widgets.

### Google Enrichment Requests

- Dataset: Spans
- Visualization: Big Number
- Query:

```text
span.op:http.client provider:google_places source:enrichment
```

- Aggregate: `count()`

### Google Enrichment Requests Over Time

- Dataset: Spans
- Visualization: Line Chart
- Query:

```text
span.op:http.client provider:google_places source:enrichment
```

- Aggregate: `count()`
- Group by: `endpoint`

### Google Enrichment Request Duration

- Dataset: Spans
- Visualization: Line Chart
- Query:

```text
span.op:http.client provider:google_places source:enrichment
```

- Aggregate: `p95(span.duration)`
- Group by: `endpoint`

### Google Enrichment Requests By Endpoint

- Dataset: Spans
- Visualization: Table
- Query:

```text
span.op:http.client provider:google_places source:enrichment
```

- Columns: `endpoint`, `method`, `status`, `count()`, `p95(span.duration)`
- Sort: `count()` descending

### Google Enrichment Errors

- Dataset: Spans
- Visualization: Big Number
- Query:

```text
span.op:http.client provider:google_places source:enrichment status:error
```

- Aggregate: `count()`

## Fallback: Events

The server also emits info-level metric events for compatibility:

```text
metric_name:google_places.api_calls source:enrichment
metric_name:google_places.api_errors source:enrichment
```

Use these only if the Spans dataset is unavailable or sampled too heavily.
