# Sentry OpenAI Requests Dashboard

This dashboard tracks OpenAI API requests made by the server.

## Primary Source: Spans

Every outbound OpenAI request is wrapped in a Sentry span:

```text
span.op = ai.openai
span.description/name = OpenAI review_summary | OpenAI homepage_summary
provider = openai
source = ai_place_summary
operation = review_summary | homepage_summary
model = <OpenAI model>
tools = none | web_search
ai.provider = openai
ai.model_id = <OpenAI model>
ai.operation = responses.create
status = success | error
```

When OpenAI returns usage data, the span also includes:

```text
ai.usage.input_tokens
ai.usage.output_tokens
ai.usage.total_tokens
```

## Suggested Widgets

Create a dashboard in Sentry with these widgets.

### OpenAI Requests

- Dataset: Spans
- Visualization: Big Number
- Query:

```text
span.op:ai.openai provider:openai
```

- Aggregate: `count()`

### OpenAI Requests Over Time

- Dataset: Spans
- Visualization: Line Chart
- Query:

```text
span.op:ai.openai provider:openai
```

- Aggregate: `count()`
- Group by: `operation`

### OpenAI Request Duration

- Dataset: Spans
- Visualization: Line Chart
- Query:

```text
span.op:ai.openai provider:openai
```

- Aggregate: `p95(span.duration)`
- Group by: `operation`

### OpenAI Requests By Model

- Dataset: Spans
- Visualization: Table
- Query:

```text
span.op:ai.openai provider:openai
```

- Columns: `model`, `operation`, `tools`, `status`, `count()`, `p95(span.duration)`
- Sort: `count()` descending

### OpenAI Errors

- Dataset: Spans
- Visualization: Big Number
- Query:

```text
span.op:ai.openai provider:openai status:error
```

- Aggregate: `count()`

## Fallback: Events

The server also emits info-level metric events for compatibility:

```text
metric_name:openai.api_requests provider:openai
metric_name:openai.api_errors provider:openai
```

Use these only if the Spans dataset is unavailable or sampled too heavily.
