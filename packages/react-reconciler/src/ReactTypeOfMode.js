/**
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 *
 * @flow
 */

export type TypeOfMode = number;
// 普通模式|Legacy模式，同步渲染，ReactV15-16生产环境用
export const NoMode = /*                         */ 0b000000;
// TODO: Remove ConcurrentMode by reading from the root tag instead
// 并发模式，17之后生产模实用
export const ConcurrentMode = /*                 */ 0b000001;
// 性能检测模式
export const ProfileMode = /*                    */ 0b000010;
export const DebugTracingMode = /*               */ 0b000100;
// 严格模式，用来检测是否存在废弃API(会多次调用渲染阶段生命周期)，React16-17开发环境使用
export const StrictLegacyMode = /*               */ 0b001000;
export const StrictEffectsMode = /*              */ 0b010000;
export const ConcurrentUpdatesByDefaultMode = /* */ 0b100000;
