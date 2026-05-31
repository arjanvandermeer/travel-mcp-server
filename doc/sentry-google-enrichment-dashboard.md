# Sentry Google Enrichment Dashboard

This dashboard tracks Google Places requests made by enrichment.

## Required Events

The server emits a normal Sentry message event for every outbound Google Places API request:

```text
message = metric:google_places.api_calls
metric_name = google_places.api_calls
provider = google_places
source = enrichment
endpoint = nearby_search | text_search | place_details
method = POST | GET
```

Google Places request failures emit:

```text
message = metric:google_places.api_errors
metric_name = google_places.api_errors
provider = google_places
source = enrichment
endpoint = nearby_search | text_search | place_details
error_status = <Google API status>
error_type = parse_error | request_error | empty_response
```

## Suggested Widgets

Create a dashboard in Sentry with these widgets.

### Google Enrichment Requests

- Dataset: Errors / Events
- Visualization: Big Number
- Query:

```text
metric_name:google_places.api_calls source:enrichment
```

- Aggregate: `count()`

### Google Enrichment Requests Over Time

- Dataset: Errors / Events
- Visualization: Line Chart
- Query:

```text
metric_name:google_places.api_calls source:enrichment
```

- Aggregate: `count()`
- Group by: `endpoint`

### Google Enrichment Request Errors

- Dataset: Errors / Events
- Visualization: Big Number
- Query:

```text
metric_name:google_places.api_errors source:enrichment
```

- Aggregate: `count()`

### Google Enrichment Errors By Type

- Dataset: Errors / Events
- Visualization: Table
- Query:

```text
metric_name:google_places.api_errors source:enrichment
```

- Columns: `endpoint`, `error_status`, `error_type`, `count()`
- Sort: `count()` descending

## Notes

The Sentry JavaScript SDK no longer exposes the old custom metrics API in the version used by this project, so these counters are emitted as normal tagged events. This makes them queryable in Discover and Dashboard widgets.
