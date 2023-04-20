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

//函数组件
export const FunctionComponent = 0;
//类组件
export const ClassComponent = 1;
//不确定的组件（在 React 16 之前使用）
export const IndeterminateComponent = 2; // Before we know whether it is function or class
//宿主根节点。可能嵌套在另一个节点内。
export const HostRoot = 3; // Root of a host tree. Could be nested inside another node. RootFiber 可以理解为根元素，通过reactDom.render()产生的根元素
//Portal 组件。是一个子树，可以作为不同渲染器的入口点
export const HostPortal = 4; // A subtree. Could be an entry point to a different renderer. 对应的ReactDom.createProtal 产生的Protal
//宿主组件。对应于浏览器中的 DOM 元素。
export const HostComponent = 5; //dom元素 比如<div>
//宿主文本组件。对应于浏览器中的文本节点。
export const HostText = 6;//文本节点
//Fragment 组件。用于渲染多个子组件而无需创建额外的 DOM 元素。
export const Fragment = 7;//<React.fragment>
//Mode 组件。用于支持不同的渲染模式。
export const Mode = 8;//<React.StrictMode>
//Context Consumer 组件。用于从 Context 中获取值。
export const ContextConsumer = 9;//对应<Context.Consumer>
//Context Provider 组件。用于向 Context 中提供值。
export const ContextProvider = 10;//对应<Context.Provider>
//Forward Ref 组件。用于将 ref 传递给子组件。
export const ForwardRef = 11;//对应React.forwardRef
//Profiler 组件。用于测量组件渲染性能。
export const Profiler = 12;//对应<profiler>
//Suspense 组件。用于异步渲染。
export const SuspenseComponent = 13;
//Memo 组件。用于优化函数组件性能。
export const MemoComponent = 14;
//简单的 Memo 组件。与 Memo 组件相似，但只能用于比较简单的组件。
export const SimpleMemoComponent = 15;
//Lazy 组件。用于异步加载组件。
export const LazyComponent = 16;
//不完整的类组件。在 React 16 之前使用。
export const IncompleteClassComponent = 17;
//在使用服务端渲染时，React 会将组件的状态序列化为字符串，然后在客户端重新挂载组件时将其反序列化。DehydratedFragment 是一个特殊的组件，用于在客户端重新挂载组件时重新注入状态。
export const DehydratedFragment = 18;
// React 18 中引入的新组件，用于支持 Suspense List 功能。Suspense List 可以在异步加载多个组件时提供更好的用户体验。
export const SuspenseListComponent = 19;
// React 18 中引入的新组件，用于支持 Scope 功能。Scope 可以在跨越多个组件的树状结构中共享数据。
export const ScopeComponent = 21;
// React 18 中引入的新组件，用于支持 Offscreen 功能。Offscreen 可以优化屏幕外的组件渲染性能。
export const OffscreenComponent = 22;
//React 18 中引入的新组件，用于支持 Legacy Hidden 功能。Legacy Hidden 可以在隐藏组件时保留其状态，以便在显示时快速恢复。
export const LegacyHiddenComponent = 23;
// React 18 中引入的新组件，用于支持 Cache 功能。Cache 可以缓存组件的渲染结果，以便在需要时快速恢复。
export const CacheComponent = 24;
//React 18 中引入的新组件，用于支持 Tracing Marker 功能。Tracing Marker 可以在开发时帮助开发者诊断性能问题。
export const TracingMarkerComponent = 25;
// React 18 中引入的新节点类型，用于标记可提升的 DOM 元素。
export const HostHoistable = 26;
// React 18 中引入的新节点类型，用于标记单例的 DOM 元素。
export const HostSingleton = 27;
