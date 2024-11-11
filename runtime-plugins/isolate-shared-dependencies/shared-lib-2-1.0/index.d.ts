declare module 'shared-lib-2' {
  export function getLib2InstanceId(): number;
  export function getLazyData(): Promise<Record<string, unknown>>;
}
