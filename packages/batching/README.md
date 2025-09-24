# @easy-sync/batching

Batching library for easy-sync.

## Usage

```ts
import { BatchManager } from '@easy-sync/batching';
import { createKeyResolver } from '@easy-sync/batching/resolvers';
import { createFixedWindowScheduler } from '@easy-sync/batching/schedulers';
import { api } from './api';

// create a batch manager with a set of options
const batchManager = new BatchManager({
  // the batch processor function - it will be called with the list of requests
  // this is where you would write the logic to handle a batch of requests
  // for example, make a single API call to the server with a combined payload of all the batched requests
  processor: async (requests) => {
    return api.batchGet(requests);
  },
  // the request resolver function - it will be called with the combined response and the requests that were batched together
  // this is where you would write the logic to extract the result for each request from the combined response
  // for example, if you are using a key resolver, you could map each key -> value pair in the combined response to the request that made that call where key = id of the request
  resolver: createKeyResolver(),
  // the scheduler function - it will be called with the first request time, the last request time, and the number of requests in the batch
  scheduler: createFixedWindowScheduler(20_000), // Optional - Default - 10 seconds fixed window scheduler
});

// You can then use the batch manager to enqueue requests

// You can enqueue a request with an id and a payload
const handle = batchManager.enqueue({ id: '1', payload: { value: 'A' } });
// or just an id
const handle = batchManager.enqueue(1);
// or just a payload (in this case, the id will be auto-generated - a Symbol)
const handle = batchManager.enqueue({ payload: { value: 'A' } });

// You can await the result of the request like any other promise
const result = await handle;
console.log(result);

// You can also cancel a request
handle.cancel();

// You can also cancel the entire batch
batchManager.cancel();

// You can also use an abort signal to cancel a request
const abortSignal = new AbortSignal();
const handle = batchManager.enqueue(1, abortSignal);
abortSignal.abort();
```

## Schedulers

The batch manager uses a scheduler to determine the delay before the batch is executed.

We have two configurable schedulers out of the box:

### Fixed Window Scheduler

```ts
// This is the default scheduler if no scheduler is provided
// This will batch all requests within a 10 second window from the first request
const scheduler = createFixedWindowScheduler(
  10_000 // window time
); 

// You can also provide a max batch size
// This will trigger the batch immediately if the batch size reaches 10 even if the 10 seconds window has not passed
const scheduler = createFixedWindowScheduler(
  10_000, // window time
  10 // max batch size
); 
```

### Debounced Scheduler

```ts
// This will batch all requests within a 10 second window from the first request, but will not wait beyond 30 seconds after the first request
const scheduler = createDebouncedScheduler(
  10_000, // delay time
  30_000 // max wait time
);

// You can also provide a max batch size
// This will trigger the batch immediately if the batch size reaches 10
const scheduler = createDebouncedScheduler(
  10_000, // delay time
  30_000, // max wait time
  10 // max batch size
); 
```

### Custom Scheduler

You can also create your own scheduler.

```ts
const scheduler = (firstRequestTime, lastRequestTime, batchSize) => {
  // Compute the delay (in milliseconds)

  // If delay is <= 0, the batch will be triggered immediately

  return delay;
};
```

## Request Resolver

The batch manager uses a request resolver to extract the result for each request from the combined response.

We have two configurable request resolvers out of the box:

### Key Resolver

```ts
const resolver = createKeyResolver();
```

For a response shape

```ts
{
  'A': { value: 'A' },
  'B': { value: 'B' },
  'C': { value: 'C' },
}
```

It will return the results for each request as follows:

```ts
// For Request Id - 'A'
{ value: 'A' }

// For Request Id - 'B'
{ value: 'B' }

// For Request Id - 'C'
{ value: 'C' }
```

### Array Index Resolver

```ts
const resolver = createArrayIndexResolver();
```

For a response shape

```ts
[{ value: 'A' }, { value: 'B' }, { value: 'C' }]
```

It will return the results for each request as follows:

```ts
{ value: 'B' }

// For Request Id - 'C'
{ value: 'C' }

// For Request Id - 'D'
{ value: 'D' }
```

### Array Find Resolver

```ts
const resolver = createArrayFindResolver('id' /* key */);
```

For a response shape

```ts
[{ id: 'A', value: 'A' }, { id: 'B', value: 'B' }, { id: 'C', value: 'C' }]
```

It will return the results for each request as follows:

```ts
// For Request Id - 'A'
{ id: 'A', value: 'A' }

// For Request Id - 'B'
{ id: 'B', value: 'B' }

// For Request Id - 'C'
{ id: 'C', value: 'C' }
```

### Custom Request Resolver

You can also create your own request resolver.

```ts
const resolver = (combinedResponse, request) => {
  // Compute the result for the request

  // The combined response is the response from the batch processor
  // The request is the request that was made (id and payload - if any)
  // This function will be called for each request in the batch
  return result;
};
```