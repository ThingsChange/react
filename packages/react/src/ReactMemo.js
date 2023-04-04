/**
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 *
 * @noflow
 */

import {REACT_MEMO_TYPE} from 'shared/ReactSymbols';

import isValidElementType from 'shared/isValidElementType';
/* 一种容器化控制渲染方案，对比props变化，来决定是否渲染组件
* 被memo包裹的组件，element会被打成React_memo_type 类型的element标签，
* 在element变成fiber的时候，fiber会被标记成MemoComponent
* */
export function memo<Props>(
  type: React$ElementType,
  compare?: (oldProps: Props, newProps: Props) => boolean,
) {
  if (__DEV__) {
    if (!isValidElementType(type)) {
      console.error(
        'memo: The first argument must be a component. Instead ' +
          'received: %s',
        type === null ? 'null' : typeof type,
      );
    }
  }
  const elementType = {
    $$typeof: REACT_MEMO_TYPE,
    type,
    compare: compare === undefined ? null : compare,
  };
  if (__DEV__) {
    let ownName;
    Object.defineProperty(elementType, 'displayName', {
      enumerable: false,
      configurable: true,
      get: function () {
        return ownName;
      },
      set: function (name) {
        ownName = name;

        // The inner component shouldn't inherit this display name in most cases,
        // because the component may be used elsewhere.
        // But it's nice for anonymous functions to inherit the name,
        // so that our component-stack generation logic will display their frames.
        // An anonymous function generally suggests a pattern like:
        //   React.memo((props) => {...});
        // This kind of inner function is not used elsewhere so the side effect is okay.
        if (!type.name && !type.displayName) {
          type.displayName = name;
        }
      },
    });
  }
  return elementType;
}
