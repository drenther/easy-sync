export type RequestResolver<Payload, Id, CombinedResponse, Result> = (
  combinedResponse: CombinedResponse,
  request: { id: Id; payload: Payload },
) => Result;

/**
 * @returns A request resolver to extract a result from an Object or Map by using the request id as the key of the result Object or Map
 *
 * Can be used with:
 * - Record<Id, Result>
 * - Map<Id, Result>
 *
 * @example Response: Record<Id, Result> where Response[Id] = Result
 * @example Response: Map<Id, Result> where Response.get(Id) = Result
 *
 * Can be used to access the result from Object or Map where the key is the `Id` of the request.
 */
export function createKeyResolver<
  Payload,
  Id extends string | number | symbol,
  Result,
>(): RequestResolver<
  Payload,
  Id,
  Record<Id, Result> | Map<Id, Result>,
  Result
> {
  return (combinedResponse, request) => {
    const idKey = request.id;
    let value: Result;
    if (combinedResponse instanceof Map) {
      value = combinedResponse.get(idKey) as Result;
    } else {
      value = (combinedResponse as Record<Id, Result>)[idKey];
    }

    return value;
  };
}

/**
 * @returns A request resolver to extract a result from an array by using the request id as the index of the result Array
 *
 * Can be used with:
 * - Array<Result>
 *
 * @example Response: Array<Result> where Response[Id] = Result
 *
 * Can be used to access the result from Array where the index is the `Id` of the request.
 */
export function createArrayIndexResolver<
  Payload,
  Id extends number,
  Result,
>(): RequestResolver<Payload, Id, Array<Result>, Result> {
  return (combinedResponse, request) => {
    const idKey = request.id;
    const value = combinedResponse[idKey] as Result;

    return value;
  };
}

/**
 * @returns A request resolver to extract a result from an array by matching the request id with a given key of the result object in the array
 *
 * Can be used with:
 * - Array<Result> where each result object has a key that matches the request id
 *
 * @example Response: Array<Result> where Response.find((result) => result.key === Id) = Result
 *
 * @param key - The key to be used to match the request id with the key of the result object
 */
export function createArrayFindResolver<
  Payload,
  Id extends string | number | symbol,
  Result,
>(key: Id): RequestResolver<Payload, Id, Array<Result>, Result> {
  return (combinedResponse, request) => {
    const idKey = request.id;
    const value = combinedResponse.find(
      (result) => (result as Record<Id, unknown>)[key] === idKey,
    ) as Result;

    return value;
  };
}
