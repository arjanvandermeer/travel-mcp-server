# Sentry OpenAI Requests Dashboard

This dashboard tracks OpenAI API requests made by the server.

## Required Events

The server emits a normal Sentry message event for every outbound OpenAI request:

```text
message = metric:openai.api_requests
metric_name = openai.api_requests
provider = openai
source = ai_place_summary
operation = review_summary | homepage_summary
model = <OpenAI model>
tools = none | web_search
status = success | error
```

OpenAI request failures also emit:

```text
message = metric:openai.api_errors
metric_name = openai.api_errors
provider = openai
source = ai_place_summary
operation = review_summary | homepage_summary
model = <OpenAI model>
tools = none | web_search
status = error
error_name = <Error class>
```

When the OpenAI SDK response includes usage information, the event contains it in `usage` extra data.

## Suggested Widgets

Create a dashboard in Sentry with these widgets.

### OpenAI Requests

- Dataset: Errors / Events
- Visualization: Big Number
- Query:

```text
metric_name:openai.api_requests provider:openai
```

- Aggregate: `count()`

### OpenAI Requests Over Time

- Dataset: Errors / Events
- Visualization: Line Chart
- Query:

```text
metric_name:openai.api_requests provider:openai
```

- Aggregate: `count()`
- Group by: `operation`

### OpenAI Requests By Model

- Dataset: Errors / Events
- Visualization: Table
- Query:

```text
metric_name:openai.api_requests provider:openai
```

- Columns: `model`, `operation`, `tools`, `status`, `count()`
- Sort: `count()` descending

### OpenAI Errors

- Dataset: Errors / Events
- Visualization: Big Number
- Query:

```text
metric_name:openai.api_errors provider:openai
```

- Aggregate: `count()`

### OpenAI Errors By Operation

- Dataset: Errors / Events
- Visualization: Table
- Query:

```text
metric_name:openai.api_errors provider:openai
```

- Columns: `operation`, `model`, `tools`, `error_name`, `count()`
- Sort: `count()` descending

## Notes

The Sentry JavaScript SDK no longer exposes the old custom metrics API in the version used by this project, so these counters are emitted as normal tagged events. This makes them queryable in Discover and Dashboard widgets.
