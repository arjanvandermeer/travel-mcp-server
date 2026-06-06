# Sentry OpenRouter Requests Dashboard

This dashboard tracks OpenRouter API requests made by the server.

## Primary Source: Spans

Every outbound OpenRouter request is wrapped in a Sentry span:

```text
span.op = ai.openrouter
span.description/name = OpenRouter review_summary | OpenRouter homepage_summary
provider = openrouter
source = ai_place_summary
operation = review_summary | homepage_summary
model = <OpenRouter model>
ai.provider = openrouter
ai.model_id = <OpenRouter model>
ai.operation = chat.completions.create
status = success | error
```

When OpenRouter returns usage data, the span also includes:

```text
ai.usage.input_tokens
ai.usage.output_tokens
ai.usage.total_tokens
```

## Suggested Widgets

Create a dashboard in Sentry with these widgets.

### OpenRouter Requests

- Dataset: Spans
- Visualization: Big Number
- Query:

```text
span.op:ai.openrouter provider:openrouter
```

- Aggregate: `count()`

### OpenRouter Requests Over Time

- Dataset: Spans
- Visualization: Line Chart
- Query:

```text
span.op:ai.openrouter provider:openrouter
```

- Aggregate: `count()`
- Group by: `operation`

### OpenRouter Request Duration

- Dataset: Spans
- Visualization: Line Chart
- Query:

```text
span.op:ai.openrouter provider:openrouter
```

- Aggregate: `p95(span.duration)`
- Group by: `operation`

### OpenRouter Requests By Model

- Dataset: Spans
- Visualization: Table
- Query:

```text
span.op:ai.openrouter provider:openrouter
```

- Columns: `model`, `operation`, `status`, `count()`, `p95(span.duration)`
- Sort: `count()` descending

### OpenRouter Errors

- Dataset: Spans
- Visualization: Big Number
- Query:

```text
span.op:ai.openrouter provider:openrouter status:error
```

- Aggregate: `count()`

## Fallback: Events

The server also emits info-level metric events for compatibility:

```text
metric_name:openrouter.api_requests provider:openrouter
metric_name:openrouter.api_errors provider:openrouter
```

Use these only if the Spans dataset is unavailable or sampled too heavily.
