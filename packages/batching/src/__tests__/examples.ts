import { BatchManager } from '..';
import { createKeyResolver } from '../resolvers';
import { createFixedWindowScheduler } from '../schedulers';

interface SingleResponse {
  uuid: string;
  label: string;
  status: string;
  createdAt: Date;
  updatedAt: Date;
}

interface BatchResponse {
  [key: string]: SingleResponse;
}

const api = {
  get: async (ids: string[]) => {
    return ids.reduce((acc, id) => {
      acc[id] = {
        uuid: id,
        label: `Label ${id}`,
        status: 'active',
        createdAt: new Date(),
        updatedAt: new Date(),
      };
      return acc;
    }, {} as BatchResponse);
  },
} as const;

const firstBatchManager = new BatchManager<
  BatchResponse,
  SingleResponse,
  string
>({
  processor: async (requests) => {
    return api.get(requests.map((request) => request.id));
  },
  resolver: createKeyResolver(),
  scheduler: createFixedWindowScheduler(1000),
});
firstBatchManager.enqueue('1');

const secondBatchManager = new BatchManager<
  BatchResponse,
  SingleResponse,
  undefined,
  { uuid: string }
>({
  processor: async (requests) => {
    return api.get(requests.flatMap((request) => request.payload.uuid));
  },
  resolver: (combinedResponse, request) => {
    return combinedResponse[request.payload.uuid] as SingleResponse;
  },
  scheduler: createFixedWindowScheduler(1000),
});
secondBatchManager.enqueue({ payload: { uuid: '1' } });
