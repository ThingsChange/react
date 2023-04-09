/**
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 *
 * @flow
 */

import type {Source} from 'shared/ReactElementType';
import type {
  RefObject,
  ReactContext,
  MutableSourceSubscribeFn,
  MutableSourceGetSnapshotFn,
  MutableSourceVersion,
  MutableSource,
  StartTransitionOptions,
  Wakeable,
  Usable,
} from 'shared/ReactTypes';
import type {WorkTag} from './ReactWorkTags';
import type {TypeOfMode} from './ReactTypeOfMode';
import type {Flags} from './ReactFiberFlags';
import type {Lane, Lanes, LaneMap} from './ReactFiberLane';
import type {RootTag} from './ReactRootTags';
import type {
  Container,
  TimeoutHandle,
  NoTimeout,
  SuspenseInstance,
} from './ReactFiberHostConfig';
import type {Cache} from './ReactFiberCacheComponent';
import type {
  TracingMarkerInstance,
  Transition,
} from './ReactFiberTracingMarkerComponent';
import type {ConcurrentUpdate} from './ReactFiberConcurrentUpdates';

// Unwind Circular: moved from ReactFiberHooks.old
export type HookType =
  | 'useState'
  | 'useReducer'
  | 'useContext'
  | 'useRef'
  | 'useEffect'
  | 'useEffectEvent'
  | 'useInsertionEffect'
  | 'useLayoutEffect'
  | 'useCallback'
  | 'useMemo'
  | 'useImperativeHandle'
  | 'useDebugValue'
  | 'useDeferredValue'
  | 'useTransition'
  | 'useMutableSource'
  | 'useSyncExternalStore'
  | 'useId'
  | 'useCacheRefresh';

export type ContextDependency<T> = {
  context: ReactContext<T>,
  next: ContextDependency<mixed> | null,
  memoizedValue: T,
  ...
};

export type Dependencies = {
  lanes: Lanes,
  firstContext: ContextDependency<mixed> | null,
  ...
};

export type MemoCache = {
  data: Array<Array<any>>,
  index: number,
};

// A Fiber is work on a Component that needs to be done or was done. There can
// be more than one per component.
export type Fiber = {
  // These first fields are conceptually members of an Instance. This used to
  // be split into a separate type and intersected with the other Fiber fields,
  // but until Flow fixes its intersection bugs, we've merged them into a
  // single type.

  // An Instance is shared between all versions of a component. We can easily
  // break this out into a separate object to avoid copying so much to the
  // alternate versions of the tree. We put this on a single object for now to
  // minimize the number of objects created during the initial render.
  // Tag identifying the type of fiber.
//   !静态数据结构，存储节点dom信息
// 表示 fiber 类型, 例如函数组件，类组件，宿主组件。根据ReactElement组件的 type 进行生成，
  tag: WorkTag,

  // Unique identifier of this child.
  //和ReactElement组件的 key 一致.
  key: null | string,

  // The value of element.type which is used to preserve the identity during
  // reconciliation of this child.
  //?一般来讲和ReactElement组件的 type 一致
  elementType: any,

  // The resolved function/class/ associated with this fiber.
  //定义与此fiber关联的功能或者类。对组件：他指向构造函数，对于DOM，他指向Html tag.
  //?一般来讲和fiber.elementType一致. 一些特殊情形下, 比如在开发环境下为了兼容热更新(HotReloading),
  //? 会对function, class, ForwardRef类型的ReactElement做一定的处理, 这种情况会区别于fiber.elementType
  type: any,

  // The local state associated with this fiber.
  //?与fiber关联的局部状态节点(比如: HostComponent类型指向与fiber节点对应的 dom 节点;
  //? 根节点fiber.stateNode指向的是FiberRoot; class 类型节点其stateNode指向的是 class 实例).
  //        对于宿主组件，这里保存宿主组件的实例, 例如DOM节点。
  //        对于类组件来说，这里保存类组件的实例
  //        对于函数组件说，这里为空，因为函数组件没有实例
  stateNode: any,

  // Conceptual aliases
  // parent : Instance -> return The parent happens to be the same as the
  // return fiber since we've merged the fiber and instance.

  // Remaining fields belong to Fiber
  // !链表树相关
  // The Fiber to return to after finishing processing this one.
  // This is effectively the parent, but there can be multiple parents (two)
  // so this is only the parent of the thing we're currently processing.
  // It is conceptually the same as the return address of a stack frame.
  //?指向处理当前fiber的父节点（因为他可能有多个父节点）
  return: Fiber | null,
  // Singly Linked List Tree Structure.
  //? 指向第一个子节点
  child: Fiber | null,
  // ? 指向第一个兄弟节点
  sibling: Fiber | null,
  //?fiber 在兄弟节点中的索引, 如果是单节点默认为 0.
  index: number,
  // The ref last used to attach this node.
  // I'll avoid adding an owner field for prod and model that as functions.
  // lj 指向在ReactElement组件上设置的 ref(string类型的ref除外, 这种类型的ref已经不推荐使用, reconciler阶段会将string类型的ref转换成一个function类型).
  ref:
    | null
    | (((handle: mixed) => void) & {_stringRef: ?string, ...})
    | RefObject,

  refCleanup: null | (() => void),
  // !工作单元
  // Input is the data coming into process this fiber. Arguments. Props.
  //lj 输入属性, 新的，待处理的Fiber的props；从ReactElement对象传入的 props. 用于和fiber.memoizedProps比较可以得出属性是否变动.
  pendingProps: any, // This type will be more specific once we overload the tag.
  // 上一次渲染用到的props
  // lj 上一次生成子节点时用到的属性, 生成子节点之后保持在内存中. 向下生成子节点之前叫做pendingProps,
  //lj  生成子节点之后会把pendingProps赋值给memoizedProps用于下一次比较.pendingProps和memoizedProps比较可以得出属性是否变动.
  memoizedProps: any, // The props used to create the output.

  // A queue of state updates and callbacks.
  //lj 存储update更新对象的队列, 每一次发起更新, 都需要在该队列上创建一个update对象.
  updateQueue: mixed,

  // The state used to create the output
  //lj 上一次生成子节点之后保持在内存中的组件状态
  memoizedState: any,

  // contexts,events等依赖
  // Dependencies (contexts, events) for this fiber, if it has any
  dependencies: Dependencies | null,

  // Bitfield that describes properties about the fiber and its subtree. E.g.
  // the ConcurrentMode flag indicates whether the subtree should be async-by-
  // default. When a fiber is created, it inherits the mode of its
  // parent. Additional flags can be set at creation time, but after that the
  // value should remain unchanged throughout the fiber's lifetime, particularly
  // before its child fibers are created.//lj legacy concurrent blocking
  mode: TypeOfMode,
  // Effect
  // ! 副作用相关
  // lj 标志位, 副作用标记（例如更新，删除、替换等）。(在 16.x 版本中叫做EffectTag, 相应pr), 在ReactFiberFlags.js中定义了所有的标志位.
  //lj reconciler阶段会将所有拥有flags标记的节点添加到副作用链表中, 等待 commit 阶段的处理.
  flags: Flags,
  // 当前子树的副作用状态
  subtreeFlags: Flags,
  // 要删除的fiber
  deletions: Array<Fiber> | null,

  // Singly linked list fast path to the next fiber with side-effects.
  nextEffect: Fiber | null,

  // The first and last fiber with side-effect within this subtree. This allows
  // us to reuse a slice of the linked list when we reuse the work done within
  // this fiber.
  firstEffect: Fiber | null,
  lastEffect: Fiber | null,
// ! 优先级相关 lj 本 fiber 节点所属的优先级, 创建 fiber 的时候设置.
  lanes: Lanes,
  //?子节点所属的优先级
  childLanes: Lanes,

  // This is a pooled version of a Fiber. Every fiber that gets updated will
  // eventually have a pair. There are cases when we can clean up pairs to save
  // memory if we need to.
  //? 替身，指向内存中的另一个 fiber, 每个被更新过 fiber 节点在内存中都是成对出现(current 和 workInProgress)
  alternate: Fiber | null,

  // Time spent rendering this Fiber and its descendants for the current update.
  // This tells us how well the tree makes use of sCU for memoization.
  // It is reset to 0 each time we render and only updated when we don't bailout.
  // This field is only set when the enableProfilerTimer flag is enabled.
  actualDuration?: number,

  // If the Fiber is currently active in the "render" phase,
  // This marks the time at which the work began.
  // This field is only set when the enableProfilerTimer flag is enabled.
  actualStartTime?: number,

  // Duration of the most recent render time for this Fiber.
  // This value is not updated when we bailout for memoization purposes.
  // This field is only set when the enableProfilerTimer flag is enabled.
  selfBaseDuration?: number,

  // Sum of base times for all descendants of this Fiber.
  // This value bubbles up during the "complete" phase.
  // This field is only set when the enableProfilerTimer flag is enabled.
  treeBaseDuration?: number,

  // Conceptual aliases
  // workInProgress : Fiber ->  alternate The alternate used for reuse happens
  // to be the same as work in progress.
  // __DEV__ only

  _debugSource?: Source | null,
  _debugOwner?: Fiber | null,
  _debugIsCurrentlyTiming?: boolean,
  _debugNeedsRemount?: boolean,

  // Used to verify that the order of hooks does not change between renders.
  _debugHookTypes?: Array<HookType> | null,
};

type BaseFiberRootProperties = {
  // The type of root (legacy, batched, concurrent, etc.)
  tag: RootTag,
  // root节点，ReactDom.render 的第二个参数
  // Any additional information from the host associated with this root.
  containerInfo: Container,
  // Used only by persistent updates.
  pendingChildren: any,
  // The currently active root fiber. This is the mutable root of the tree.
  current: Fiber,

  pingCache: WeakMap<Wakeable, Set<mixed>> | Map<Wakeable, Set<mixed>> | null,

  // A finished work-in-progress HostRoot that's ready to be committed.
  // 已经完成任务的fiberRoot对象，在commit阶段只会处理该值对应的任务
  finishedWork: Fiber | null,
  // Timeout handle returned by setTimeout. Used to cancel a pending timeout, if
  // it's superseded by a new one.
  timeoutHandle: TimeoutHandle | NoTimeout,
  // Top context object, used by renderSubtreeIntoContainer
  context: Object | null,
  pendingContext: Object | null,

  // Used by useMutableSource hook to avoid tearing during hydration.
  mutableSourceEagerHydrationData?: Array<
    MutableSource<any> | MutableSourceVersion,
  > | null,

  // Node returned by Scheduler.scheduleCallback. Represents the next rendering
  // task that the root will work on.
  callbackNode: any,
  callbackPriority: Lane,
  eventTimes: LaneMap<number>,
  expirationTimes: LaneMap<number>,
  hiddenUpdates: LaneMap<Array<ConcurrentUpdate> | null>,

  pendingLanes: Lanes,
  suspendedLanes: Lanes,
  pingedLanes: Lanes,
  expiredLanes: Lanes,
  mutableReadLanes: Lanes,
  errorRecoveryDisabledLanes: Lanes,

  finishedLanes: Lanes,

  entangledLanes: Lanes,
  entanglements: LaneMap<Lanes>,

  pooledCache: Cache | null,
  pooledCacheLanes: Lanes,

  // TODO: In Fizz, id generation is specific to each server config. Maybe we
  // should do this in Fiber, too? Deferring this decision for now because
  // there's no other place to store the prefix except for an internal field on
  // the public createRoot object, which the fiber tree does not currently have
  // a reference to.
  identifierPrefix: string,

  onRecoverableError: (
    error: mixed,
    errorInfo: {digest?: ?string, componentStack?: ?string},
  ) => void,
};

// The following attributes are only used by DevTools and are only present in DEV builds.
// They enable DevTools Profiler UI to show which Fiber(s) scheduled a given commit.
type UpdaterTrackingOnlyFiberRootProperties = {
  memoizedUpdaters: Set<Fiber>,
  pendingUpdatersLaneMap: LaneMap<Set<Fiber>>,
};

export type SuspenseHydrationCallbacks = {
  onHydrated?: (suspenseInstance: SuspenseInstance) => void,
  onDeleted?: (suspenseInstance: SuspenseInstance) => void,
  ...
};

// The follow fields are only used by enableSuspenseCallback for hydration.
type SuspenseCallbackOnlyFiberRootProperties = {
  hydrationCallbacks: null | SuspenseHydrationCallbacks,
};

export type TransitionTracingCallbacks = {
  onTransitionStart?: (transitionName: string, startTime: number) => void,
  onTransitionProgress?: (
    transitionName: string,
    startTime: number,
    currentTime: number,
    pending: Array<{name: null | string}>,
  ) => void,
  onTransitionIncomplete?: (
    transitionName: string,
    startTime: number,
    deletions: Array<{
      type: string,
      name?: string | null,
      endTime: number,
    }>,
  ) => void,
  onTransitionComplete?: (
    transitionName: string,
    startTime: number,
    endTime: number,
  ) => void,
  onMarkerProgress?: (
    transitionName: string,
    marker: string,
    startTime: number,
    currentTime: number,
    pending: Array<{name: null | string}>,
  ) => void,
  onMarkerIncomplete?: (
    transitionName: string,
    marker: string,
    startTime: number,
    deletions: Array<{
      type: string,
      name?: string | null,
      endTime: number,
    }>,
  ) => void,
  onMarkerComplete?: (
    transitionName: string,
    marker: string,
    startTime: number,
    endTime: number,
  ) => void,
};

// The following fields are only used in transition tracing in Profile builds
type TransitionTracingOnlyFiberRootProperties = {
  transitionCallbacks: null | TransitionTracingCallbacks,
  transitionLanes: Array<Set<Transition> | null>,
  // Transitions on the root can be represented as a bunch of tracing markers.
  // Each entangled group of transitions can be treated as a tracing marker.
  // It will have a set of pending suspense boundaries. These transitions
  // are considered complete when the pending suspense boundaries set is
  // empty. We can represent this as a Map of transitions to suspense
  // boundary sets
  incompleteTransitions: Map<Transition, TracingMarkerInstance>,
};

// Exported FiberRoot type includes all properties,
// To avoid requiring potentially error-prone :any casts throughout the project.
// The types are defined separately within this file to ensure they stay in sync.
export type FiberRoot = {
  ...BaseFiberRootProperties,
  ...SuspenseCallbackOnlyFiberRootProperties,
  ...UpdaterTrackingOnlyFiberRootProperties,
  ...TransitionTracingOnlyFiberRootProperties,
  ...
};

type BasicStateAction<S> = (S => S) | S;
type Dispatch<A> = A => void;

export type Dispatcher = {
  use?: <T>(Usable<T>) => T,
  readContext<T>(context: ReactContext<T>): T,
  useState<S>(initialState: (() => S) | S): [S, Dispatch<BasicStateAction<S>>],
  useReducer<S, I, A>(
    reducer: (S, A) => S,
    initialArg: I,
    init?: (I) => S,
  ): [S, Dispatch<A>],
  useContext<T>(context: ReactContext<T>): T,
  useRef<T>(initialValue: T): {current: T},
  useEffect(
    create: () => (() => void) | void,
    deps: Array<mixed> | void | null,
  ): void,
  useEffectEvent?: <Args, Return, F: (...Array<Args>) => Return>(
    callback: F,
  ) => F,
  useInsertionEffect(
    create: () => (() => void) | void,
    deps: Array<mixed> | void | null,
  ): void,
  useLayoutEffect(
    create: () => (() => void) | void,
    deps: Array<mixed> | void | null,
  ): void,
  useCallback<T>(callback: T, deps: Array<mixed> | void | null): T,
  useMemo<T>(nextCreate: () => T, deps: Array<mixed> | void | null): T,
  useImperativeHandle<T>(
    ref: {current: T | null} | ((inst: T | null) => mixed) | null | void,
    create: () => T,
    deps: Array<mixed> | void | null,
  ): void,
  useDebugValue<T>(value: T, formatterFn: ?(value: T) => mixed): void,
  useDeferredValue<T>(value: T): T,
  useTransition(): [
    boolean,
    (callback: () => void, options?: StartTransitionOptions) => void,
  ],
  useMutableSource<TSource, Snapshot>(
    source: MutableSource<TSource>,
    getSnapshot: MutableSourceGetSnapshotFn<TSource, Snapshot>,
    subscribe: MutableSourceSubscribeFn<TSource, Snapshot>,
  ): Snapshot,
  useSyncExternalStore<T>(
    subscribe: (() => void) => () => void,
    getSnapshot: () => T,
    getServerSnapshot?: () => T,
  ): T,
  useId(): string,
  useCacheRefresh?: () => <T>(?() => T, ?T) => void,
  useMemoCache?: (size: number) => Array<any>,
};

export type CacheDispatcher = {
  getCacheSignal: () => AbortSignal,
  getCacheForType: <T>(resourceType: () => T) => T,
};
