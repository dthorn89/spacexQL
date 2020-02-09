import { GraphqlUnknownError, GraphqlError } from '../GraphqlError';
import { Watcher } from '../utils/Watcher';
import { GraphqlEngine, GraphqlEngineStatus, OperationParameters, GraphqlQueryWatch, GraphqlQueryResult, GraphqlSubscriptionHandler, GraphqlActiveSubscription } from '../GraphqlEngine';
import { Definitions } from './types';
import { WebTransport } from './transport/WebTransport';
import { WebStore } from './store/WebStore';
import { randomKey } from '../utils/randomKey';
import { Queue } from '../utils/Queue';

class QueryWatchState {
    hasValue: boolean = false;
    hasError: boolean = false;
    value?: any;
    error?: Error;
}

export interface WebEngineOpts {
    endpoint: string;
    connectionParams?: any;
    protocol?: 'apollo' | 'openland';
    onConnectionFailed?: (message: string) => void;
    logging?: boolean;
}

export class WebEngine implements GraphqlEngine {

    protected readonly statusWatcher: Watcher<GraphqlEngineStatus> = new Watcher();
    get status(): GraphqlEngineStatus {
        return this.statusWatcher.getState()!!;
    }
    private readonly store = new WebStore();
    private readonly transport: WebTransport;
    private readonly definitions: Definitions;

    constructor(definitions: Definitions, opts: WebEngineOpts) {
        this.transport = new WebTransport(opts);
        this.statusWatcher.setState({ status: 'connecting' });
        this.definitions = definitions;

        this.transport.onStatusChanged = (status) => {
            this.statusWatcher.setState(status);
        };
    }

    close() {
        throw new GraphqlUnknownError('not yet implemented');
    }

    watchStatus(handler: (status: GraphqlEngineStatus) => void) {
        return this.statusWatcher.watch(handler);
    }

    //
    // Operations
    //

    async query<TQuery, TVars>(query: string, vars?: TVars, params?: OperationParameters): Promise<TQuery> {
        let operation = this.definitions.operations[query];
        if (!operation) {
            throw new GraphqlUnknownError('Unknown operation');
        }
        if (operation.kind !== 'query') {
            throw new GraphqlUnknownError('Invalid operation kind');
        }

        let fetchPolicy: 'cache-first' | 'network-only' | 'cache-and-network' | 'no-cache' = 'cache-first';
        if (params && params.fetchPolicy) {
            fetchPolicy = params.fetchPolicy;
        }

        if (fetchPolicy === 'cache-and-network') {
            throw new GraphqlUnknownError('Unable to use CACHE_AND_NETWORK policy for non watchable query');
        }

        if (fetchPolicy === 'cache-first') {
            let ex = await this.store.readQuery(operation, vars);
            if (ex.result) {
                return ex.value!;
            }
        }

        let r = await this.transport.operation(operation, vars);
        if (r.type === 'result') {
            try {
                await this.store.mergeResponse(operation, vars, r.value);
            } catch (e) {
                console.warn('Mailformed response: ', r.value);
                throw new GraphqlUnknownError('Mailformed response');
            }
            return r.value;
        } else if (r.type === 'error') {
            throw new GraphqlError(r.errors);
        } else {
            throw new GraphqlUnknownError('Internal error');
        }
    }
    queryWatch<TQuery, TVars>(query: string, vars?: TVars, params?: OperationParameters): GraphqlQueryWatch<TQuery> {
        let operation = this.definitions.operations[query];
        let fetchPolicy: 'cache-first' | 'network-only' | 'cache-and-network' | 'no-cache' = 'cache-first';
        if (params && params.fetchPolicy) {
            fetchPolicy = params.fetchPolicy;
        }
        if (!operation) {
            throw new GraphqlUnknownError('Unknown operation');
        }
        if (operation.kind !== 'query') {
            throw new GraphqlUnknownError('Invalid operation kind: ' + operation.kind);
        }

        let state = new QueryWatchState();
        let callbacks = new Map<string, (args: { data?: TQuery, error?: Error }) => void>();
        let resolved = false;
        let resolve!: () => void;
        let reject!: () => void;
        let promise = new Promise<void>((rl, rj) => {
            resolve = rl;
            reject = rj;
        });

        let completed = false;
        let wasLoadedFromNetwork = false;

        let doRequest: (reload: boolean) => Promise<void>;
        let doReloadFromCache: () => Promise<void>;

        let onResult = (v: any) => {
            if (completed) {
                return;
            }
            state.hasError = false;
            state.hasValue = true;
            state.value = v;
            state.error = undefined;

            if (!resolved) {
                resolved = true;
                resolve();
            }

            for (let i of callbacks.values()) {
                i({ data: v });
            }
        };

        let onError = (e: Error) => {
            if (completed) {
                return;
            }
            state.hasError = true;
            state.hasValue = false;
            state.value = undefined;
            state.error = e;

            if (!resolved) {
                resolved = true;
                reject();
            }

            for (let i of callbacks.values()) {
                i({ error: e });
            }
        };

        doReloadFromCache = async () => {
            this.store.readQueryAndWatch(operation, vars, (s) => {
                if (completed) {
                    return;
                }
                if (s.type === 'value') {
                    onResult(s.value);
                    if (fetchPolicy === 'cache-and-network' && !wasLoadedFromNetwork) {
                        doRequest(false);
                    }
                } else if (s.type === 'missing') {
                    doRequest(true);
                } else if (s.type === 'updated') {
                    doReloadFromCache();
                }
            });
        };

        doRequest = async (reload: boolean) => {
            wasLoadedFromNetwork = true;
            let it = await this.transport.operation(operation, vars);
            if (it.type === 'result') {
                try {
                    await this.store.mergeResponse(operation, vars, it.value);
                } catch (e) {
                    console.warn('Mailformed response: ', it.value);
                    if (completed) {
                        return;
                    }
                    if (reload) {
                        onError(new GraphqlUnknownError('Mailformed response'));
                    }
                }

                if (completed) {
                    return;
                }
                if (reload) {
                    doReloadFromCache();
                }
            } else if (it.type === 'error') {
                if (reload) {
                    onError(new GraphqlError(it.errors));
                }
            } else {
                throw new GraphqlUnknownError('Internal Error');
            }
        };

        if (fetchPolicy === 'cache-first' || fetchPolicy === 'cache-and-network') {
            doReloadFromCache();
        } else {
            doRequest(true);
        }

        return {
            subscribe: (handler: (args: GraphqlQueryResult<TQuery>) => void) => {
                let cbid = randomKey();
                callbacks.set(cbid, handler);
                return () => {
                    callbacks.delete(cbid);
                };
            },
            currentResult: () => {
                if (state.hasError) {
                    return ({ error: state.error });
                } else if (state.hasValue) {
                    return ({ data: state.value });
                }
                return undefined;
            },
            result: () => {
                return promise;
            },
            destroy: () => {
                if (!completed) {
                    completed = true;
                    // TODO: Better destroy
                }
            }
        };
    }

    async mutate<TMutation, TVars>(mutation: string, vars?: TVars): Promise<TMutation> {
        let operation = this.definitions.operations[mutation];
        if (!operation) {
            throw new GraphqlUnknownError('Unknown operation');
        }
        if (operation.kind !== 'mutation') {
            throw new GraphqlUnknownError('Invalid operation kind');
        }
        let r = await this.transport.operation(operation, vars);
        if (r.type === 'result') {
            try {
                await this.store.mergeResponse(operation, vars, r.value);
            } catch (e) {
                console.warn('Mailformed response: ', r.value);
                throw new GraphqlUnknownError('Mailformed response');
            }
            return r.value;
        } else if (r.type === 'error') {
            throw new GraphqlError(r.errors);
        } else {
            throw new GraphqlUnknownError('Internal Error');
        }
    }

    subscribe<TSubscription, TVars>(handler: GraphqlSubscriptionHandler<TSubscription>, subscription: string, vars?: TVars): GraphqlActiveSubscription<TSubscription> {
        let operation = this.definitions.operations[subscription];
        if (!operation) {
            throw new GraphqlUnknownError('Unknown operation');
        }
        if (operation.kind !== 'subscription') {
            throw new GraphqlUnknownError('Invalid operation kind');
        }
        let completed = false;
        let queue = new Queue();
        let runningOperation = this.transport.subscription(operation, vars, (s) => {
            if (completed) {
                return;
            }
            if (s.type === 'completed') {
                completed = true;
                runningOperation();
                handler({ type: 'stopped', error: new GraphqlUnknownError('Subscription stopped') });
            } else if (s.type === 'error') {
                completed = true;
                runningOperation();
                handler({ type: 'stopped', error: new GraphqlError(s.errors) });
            } else if (s.type === 'result') {
                (async () => {
                    try {
                        await this.store.mergeResponse(operation, vars, s.value);
                    } catch (e) {
                        console.warn(e);
                        if (!completed) {
                            completed = true;
                            runningOperation();
                            handler({ type: 'stopped', error: new GraphqlUnknownError('Mailformed message') });
                        }
                        return;
                    }
                    if (!completed) {
                        handler({ type: 'message', message: s.value });
                    }
                })();
            } else {
                throw new GraphqlUnknownError('Internal Error');
            }
        });

        return {
            destroy: () => {
                if (!completed) {
                    completed = true;
                    runningOperation();
                }
            }
        };
    }

    // Store

    async updateQuery<TQuery, TVars>(updater: (data: TQuery) => TQuery | null, query: string, vars?: TVars): Promise<boolean> {
        let r = await this.readQuery<TQuery, TVars>(query, vars);
        if (r) {
            let udpated = updater(r);
            if (udpated) {
                await this.writeQuery<TQuery, TVars>(r, query, vars);
                return true;
            }
        }
        return false;
    }

    async readQuery<TQuery, TVars>(query: string, vars?: TVars): Promise<TQuery | null> {
        let r = await this.store.readQuery(this.definitions.operations[query], vars);
        if (r.result) {
            return r.value! as TQuery;
        } else {
            return null;
        }
    }
    async writeQuery<TQuery, TVars>(data: TQuery, query: string, vars?: TVars): Promise<void> {
        await this.store.mergeResponse(this.definitions.operations[query], vars, data);
    }
}