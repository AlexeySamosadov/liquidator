import { Address } from '../../src/types';
import { COMMON_TOKENS } from '../../src/config/tokens';

type Route = { path: Address[]; fees: number[]; expectedOut: bigint };

type RouteRecord = {
  tokenIn: Address;
  tokenOut: Address;
  amountIn: bigint;
  result: Route;
};

// Lightweight route optimizer mock; configurable with pre-registered routes.
export class MockRouteOptimizer {
  private routes = new Map<string, Route>();

  private estimatedOutput: bigint | undefined;

  private shouldFailEstimate = false;

  private history: RouteRecord[] = [];

  private calls: Record<string, number> = {};

  mockRoute(tokenIn: Address, tokenOut: Address, route: Route): void {
    this.routes.set(this.key(tokenIn, tokenOut), route);
  }

  mockDirectRoute(tokenIn: Address, tokenOut: Address, fee: number, expectedOut: bigint): void {
    this.mockRoute(tokenIn, tokenOut, { path: [tokenIn, tokenOut], fees: [fee], expectedOut });
  }

  mockMultiHopRoute(tokenIn: Address, intermediary: Address, tokenOut: Address, fees: number[], expectedOut: bigint): void {
    this.mockRoute(tokenIn, tokenOut, { path: [tokenIn, intermediary, tokenOut], fees, expectedOut });
  }

  mockNoRoute(tokenIn: Address, tokenOut: Address): void {
    this.mockRoute(tokenIn, tokenOut, { path: [], fees: [], expectedOut: 0n });
  }

  mockEstimatedOutput(output: bigint): void {
    this.estimatedOutput = output;
  }

  shouldFailEstimation(fail: boolean): void {
    this.shouldFailEstimate = fail;
  }

  async findBestRoute(tokenIn: Address, tokenOut: Address, amountIn: bigint): Promise<Route> {
    this.calls.findBestRoute = (this.calls.findBestRoute ?? 0) + 1;
    const found = this.routes.get(this.key(tokenIn, tokenOut));
    const result = found ?? { path: [tokenIn, COMMON_TOKENS.WBNB, tokenOut], fees: [500, 500], expectedOut: this.estimatedOutput ?? amountIn };
    this.history.push({ tokenIn, tokenOut, amountIn, result });
    return result;
  }

  async estimateMultiHopOutput(path: Address[], fees: number[], amountIn: bigint): Promise<bigint> {
    this.calls.estimateMultiHopOutput = (this.calls.estimateMultiHopOutput ?? 0) + 1;
    if (this.shouldFailEstimate) return 0n;
    if (this.estimatedOutput !== undefined) return this.estimatedOutput;
    if (path.length < 2 || fees.length !== path.length - 1) return 0n;
    return amountIn; // simplistic passthrough for tests
  }

  getRouteHistory(): RouteRecord[] {
    return this.history;
  }

  getRegisteredRoutes(): Map<string, Route> {
    return this.routes;
  }

  getCallCount(method: string): number {
    return this.calls[method] ?? 0;
  }

  private key(tokenIn: Address, tokenOut: Address): string {
    return `${tokenIn.toLowerCase()}-${tokenOut.toLowerCase()}`;
  }
}

export default MockRouteOptimizer;
