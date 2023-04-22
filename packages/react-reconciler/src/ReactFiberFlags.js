/**
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 *
 * @flow
 */

import {enableCreateEventHandleAPI} from 'shared/ReactFeatureFlags';

/*
* 挂载fiber身上，副作用标记，标志当前fiber要进行的操作。e.g. Placement 代表该fiber节点对应的DOM需要插入到页面中
* */
export type Flags = number;

// Don't change these values. They're used by React Dev Tools.
//没有任何副作用标记
export const NoFlags = /*                      */ 0b000000000000000000000000000;
// 表示该Fiber节点已经执行过任务。
export const PerformedWork = /*                */ 0b000000000000000000000000001;
//代表该Fiber节点对应的DOM需要插入到页面中。
export const Placement = /*                    */ 0b000000000000000000000000010;
//表示该Fiber节点在处理过程中发生了错误并被捕获。
export const DidCapture = /*                   */ 0b000000000000000000010000000;
// 表示该Fiber节点正在被“水化”，即正在将服务器渲染的HTML转换为React元素树。
export const Hydrating = /*                    */ 0b000000000000001000000000000;

// You can change the rest (and add more)
//代表该Fiber节点需要更新。
export const Update = /*                       */ 0b000000000000000000000000100;
/* Skipped value:                                 0b000000000000000000000001000; */
//表示该Fiber节点的子节点需要被删除。
export const ChildDeletion = /*                */ 0b000000000000000000000010000;
//表示该Fiber节点对应的DOM的内容需要被重置。
export const ContentReset = /*                 */ 0b000000000000000000000100000;
//代表该Fiber节点需要执行回调函数。setState的callback
export const Callback = /*                     */ 0b000000000000000000001000000;
/* Used by DidCapture:                            0b000000000000000000010000000; */
//表示该Fiber节点需要强制客户端渲染。
export const ForceClientRender = /*            */ 0b000000000000000000100000000;
//代表该Fiber节点对应的DOM需要被引用。
export const Ref = /*                          */ 0b000000000000000001000000000;
//表示该Fiber节点需要进行快照操作。
export const Snapshot = /*                     */ 0b000000000000000010000000000;
//代表该Fiber节点对应的副作用是被动的，即不会产生任何可见变化。useEffect类型的钩子函数
export const Passive = /*                      */ 0b000000000000000100000000000;
/* Used by Hydrating:                             0b000000000000001000000000000; */
//代表该Fiber节点对应的DOM需要被挂起或恢复。
export const Visibility = /*                   */ 0b000000000000010000000000000;
//表示该Fiber节点需要保持状态一致性。
export const StoreConsistency = /*             */ 0b000000000000100000000000000;

export const LifecycleEffectMask =
  Passive | Update | Callback | Ref | Snapshot | StoreConsistency;

// Union of all commit flags (flags with the lifetime of a particular commit)
export const HostEffectMask = /*               */ 0b00000000000011111111111111;

// These are not really side effects, but we still reuse this field.
//表示该Fiber节点的工作尚未完成
export const Incomplete = /*                   */ 0b000000000001000000000000000;
//表示该Fiber节点需要捕获错误。
export const ShouldCapture = /*                */ 0b000000000010000000000000000;
//表示该Fiber节点需要强制更新以支持旧版的Suspense。
export const ForceUpdateForLegacySuspense = /* */ 0b000000000100000000000000000;
//表示该Fiber节点已经传播了上下文。
export const DidPropagateContext = /*          */ 0b000000001000000000000000000;
//表示该Fiber节点需要传播上下文。
export const NeedsPropagation = /*             */ 0b000000010000000000000000000;
//表示该Fiber节点已经被分叉。
export const Forked = /*                       */ 0b000000100000000000000000000;

// Static tags describe aspects of a fiber that are not specific to a render,
// e.g. a fiber uses a passive effect (even if there are no updates on this particular render).
// This enables us to defer more work in the unmount case,
// since we can defer traversing the tree during layout to look for Passive effects,
// and instead rely on the static flag as a signal that there may be cleanup work.
//表示该Fiber节点对应的DOM需要被静态引用。
export const RefStatic = /*                    */ 0b000001000000000000000000000;
//表示该Fiber节点的布局是静态的。
export const LayoutStatic = /*                 */ 0b000010000000000000000000000;
//表示该Fiber节点的副作用是静态的。
export const PassiveStatic = /*                */ 0b000100000000000000000000000;

// Flag used to identify newly inserted fibers. It isn't reset after commit unlike `Placement`.
export const PlacementDEV = /*                 */ 0b001000000000000000000000000;
export const MountLayoutDev = /*               */ 0b010000000000000000000000000;
//表示该Fiber节点的副作用需要被挂载（仅用于开发环境）。
export const MountPassiveDev = /*              */ 0b100000000000000000000000000;

// Groups of flags that are used in the commit phase to skip over trees that
// don't contain effects, by checking subtreeFlags.

export const BeforeMutationMask: number =
  // TODO: Remove Update flag from before mutation phase by re-landing Visibility
  // flag logic (see #20043)
  Update |
  Snapshot |
  (enableCreateEventHandleAPI
    ? // createEventHandle needs to visit deleted and hidden trees to
      // fire beforeblur
      // TODO: Only need to visit Deletions during BeforeMutation phase if an
      // element is focused.
      ChildDeletion | Visibility
    : 0);

export const MutationMask =
  Placement |
  Update |
  ChildDeletion |
  ContentReset |
  Ref |
  Hydrating |
  Visibility;
export const LayoutMask = Update | Callback | Ref | Visibility;

// TODO: Split into PassiveMountMask and PassiveUnmountMask
export const PassiveMask = Passive | Visibility | ChildDeletion;

// Union of tags that don't get reset on clones.
// This allows certain concepts to persist without recalculating them,
// e.g. whether a subtree contains passive effects or portals.
export const StaticMask = LayoutStatic | PassiveStatic | RefStatic;
