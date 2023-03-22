/**
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 *
 * @flow
 */

export type WorkTag =
  | 0
  | 1
  | 2
  | 3
  | 4
  | 5
  | 6
  | 7
  | 8
  | 9
  | 10
  | 11
  | 12
  | 13
  | 14
  | 15
  | 16
  | 17
  | 18
  | 19
  | 20
  | 21
  | 22
  | 23
  | 24
  | 25
  | 26
  | 27;

export const FunctionComponent = 0;//函数组件
export const ClassComponent = 1;//类组件
export const IndeterminateComponent = 2; // Before we know whether it is function or class
export const HostRoot = 3; // Root of a host tree. Could be nested inside another node. RootFiber 可以理解为根元素，通过reactDom.render()产生的根元素
export const HostPortal = 4; // A subtree. Could be an entry point to a different renderer. 对应的ReactDom.createProtal 产生的Protal
export const HostComponent = 5; //dom元素 比如<div>
export const HostText = 6;//文本节点
export const Fragment = 7;//<React.fragment>
export const Mode = 8;//<React.StrictMode>
export const ContextConsumer = 9;//对应<Context.Consumer>
export const ContextProvider = 10;//对应<Context.Provider>
export const ForwardRef = 11;//对应React.forwardRef
export const Profiler = 12;//对应<profiler>
export const SuspenseComponent = 13;//suspense
export const MemoComponent = 14;// 对应 React.memo 返回的组件
export const SimpleMemoComponent = 15;
export const LazyComponent = 16;
export const IncompleteClassComponent = 17;
export const DehydratedFragment = 18;
export const SuspenseListComponent = 19;
export const ScopeComponent = 21;
export const OffscreenComponent = 22;
export const LegacyHiddenComponent = 23;
export const CacheComponent = 24;
export const TracingMarkerComponent = 25;
export const HostHoistable = 26;
export const HostSingleton = 27;
