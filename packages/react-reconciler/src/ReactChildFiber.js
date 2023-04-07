/**
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 *
 * @flow
 */

import type {ReactElement} from 'shared/ReactElementType';
import type {ReactPortal, Thenable, ReactContext} from 'shared/ReactTypes';
import type {Fiber} from './ReactInternalTypes';
import type {Lanes} from './ReactFiberLane';
import type {ThenableState} from './ReactFiberThenable';

import getComponentNameFromFiber from 'react-reconciler/src/getComponentNameFromFiber';
import {
  Placement,
  ChildDeletion,
  Forked,
  PlacementDEV,
} from './ReactFiberFlags';
import {
  getIteratorFn,
  REACT_ELEMENT_TYPE,
  REACT_FRAGMENT_TYPE,
  REACT_PORTAL_TYPE,
  REACT_LAZY_TYPE,
  REACT_CONTEXT_TYPE,
  REACT_SERVER_CONTEXT_TYPE,
} from 'shared/ReactSymbols';
import {ClassComponent, HostText, HostPortal, Fragment} from './ReactWorkTags';
import isArray from 'shared/isArray';
import {checkPropStringCoercion} from 'shared/CheckStringCoercion';

import {
  createWorkInProgress,
  resetWorkInProgress,
  createFiberFromElement,
  createFiberFromFragment,
  createFiberFromText,
  createFiberFromPortal,
} from './ReactFiber';
import {isCompatibleFamilyForHotReloading} from './ReactFiberHotReloading';
import {getIsHydrating} from './ReactFiberHydrationContext';
import {pushTreeFork} from './ReactFiberTreeContext';
import {createThenableState, trackUsedThenable} from './ReactFiberThenable';
import {readContextDuringReconcilation} from './ReactFiberNewContext';

// This tracks the thenables that are unwrapped during reconcilation.
let thenableState: ThenableState | null = null;
let thenableIndexCounter: number = 0;

let didWarnAboutMaps;
let didWarnAboutGenerators;
let didWarnAboutStringRefs;
let ownerHasKeyUseWarning;
let ownerHasFunctionTypeWarning;
let warnForMissingKey = (child: mixed, returnFiber: Fiber) => {};

if (__DEV__) {
  didWarnAboutMaps = false;
  didWarnAboutGenerators = false;
  didWarnAboutStringRefs = ({}: {[string]: boolean});

  /**
   * Warn if there's no key explicitly set on dynamic arrays of children or
   * object keys are not valid. This allows us to keep track of children between
   * updates.
   */
  ownerHasKeyUseWarning = ({}: {[string]: boolean});
  ownerHasFunctionTypeWarning = ({}: {[string]: boolean});

  warnForMissingKey = (child: mixed, returnFiber: Fiber) => {
    if (child === null || typeof child !== 'object') {
      return;
    }
    if (!child._store || child._store.validated || child.key != null) {
      return;
    }

    if (typeof child._store !== 'object') {
      throw new Error(
        'React Component in warnForMissingKey should have a _store. ' +
          'This error is likely caused by a bug in React. Please file an issue.',
      );
    }

    // $FlowFixMe unable to narrow type from mixed to writable object
    child._store.validated = true;

    const componentName = getComponentNameFromFiber(returnFiber) || 'Component';

    if (ownerHasKeyUseWarning[componentName]) {
      return;
    }
    ownerHasKeyUseWarning[componentName] = true;

    console.error(
      'Each child in a list should have a unique ' +
        '"key" prop. See https://reactjs.org/link/warning-keys for ' +
        'more information.',
    );
  };
}

function isReactClass(type: any) {
  return type.prototype && type.prototype.isReactComponent;
}

function unwrapThenable<T>(thenable: Thenable<T>): T {
  const index = thenableIndexCounter;
  thenableIndexCounter += 1;
  if (thenableState === null) {
    thenableState = createThenableState();
  }
  return trackUsedThenable(thenableState, thenable, index);
}

function coerceRef(
  returnFiber: Fiber,
  current: Fiber | null,
  element: ReactElement,
) {
  const mixedRef = element.ref;
  if (
    mixedRef !== null &&
    typeof mixedRef !== 'function' &&
    typeof mixedRef !== 'object'
  ) {
    if (__DEV__) {
      if (
        // We warn in ReactElement.js if owner and self are equal for string refs
        // because these cannot be automatically converted to an arrow function
        // using a codemod. Therefore, we don't have to warn about string refs again.
        !(
          element._owner &&
          element._self &&
          element._owner.stateNode !== element._self
        ) &&
        // Will already throw with "Function components cannot have string refs"
        !(
          element._owner &&
          ((element._owner: any): Fiber).tag !== ClassComponent
        ) &&
        // Will already warn with "Function components cannot be given refs"
        !(typeof element.type === 'function' && !isReactClass(element.type)) &&
        // Will already throw with "Element ref was specified as a string (someStringRef) but no owner was set"
        element._owner
      ) {
        const componentName =
          getComponentNameFromFiber(returnFiber) || 'Component';
        if (!didWarnAboutStringRefs[componentName]) {
          console.error(
            'Component "%s" contains the string ref "%s". Support for string refs ' +
              'will be removed in a future major release. We recommend using ' +
              'useRef() or createRef() instead. ' +
              'Learn more about using refs safely here: ' +
              'https://reactjs.org/link/strict-mode-string-ref',
            componentName,
            mixedRef,
          );
          didWarnAboutStringRefs[componentName] = true;
        }
      }
    }

    if (element._owner) {
      const owner: ?Fiber = (element._owner: any);
      let inst;
      if (owner) {
        const ownerFiber = ((owner: any): Fiber);

        if (ownerFiber.tag !== ClassComponent) {
          throw new Error(
            'Function components cannot have string refs. ' +
              'We recommend using useRef() instead. ' +
              'Learn more about using refs safely here: ' +
              'https://reactjs.org/link/strict-mode-string-ref',
          );
        }

        inst = ownerFiber.stateNode;
      }

      if (!inst) {
        throw new Error(
          `Missing owner for string ref ${mixedRef}. This error is likely caused by a ` +
            'bug in React. Please file an issue.',
        );
      }
      // Assigning this to a const so Flow knows it won't change in the closure
      const resolvedInst = inst;

      if (__DEV__) {
        checkPropStringCoercion(mixedRef, 'ref');
      }
      const stringRef = '' + mixedRef;
      // Check if previous string ref matches new string ref
      if (
        current !== null &&
        current.ref !== null &&
        typeof current.ref === 'function' &&
        current.ref._stringRef === stringRef
      ) {
        return current.ref;
      }
      const ref = function (value: mixed) {
        const refs = resolvedInst.refs;
        if (value === null) {
          delete refs[stringRef];
        } else {
          refs[stringRef] = value;
        }
      };
      ref._stringRef = stringRef;
      return ref;
    } else {
      if (typeof mixedRef !== 'string') {
        throw new Error(
          'Expected ref to be a function, a string, an object returned by React.createRef(), or null.',
        );
      }

      if (!element._owner) {
        throw new Error(
          `Element ref was specified as a string (${mixedRef}) but no owner was set. This could happen for one of` +
            ' the following reasons:\n' +
            '1. You may be adding a ref to a function component\n' +
            "2. You may be adding a ref to a component that was not created inside a component's render method\n" +
            '3. You have multiple copies of React loaded\n' +
            'See https://reactjs.org/link/refs-must-have-owner for more information.',
        );
      }
    }
  }
  return mixedRef;
}

function throwOnInvalidObjectType(returnFiber: Fiber, newChild: Object) {
  // $FlowFixMe[method-unbinding]
  const childString = Object.prototype.toString.call(newChild);

  throw new Error(
    `Objects are not valid as a React child (found: ${
      childString === '[object Object]'
        ? 'object with keys {' + Object.keys(newChild).join(', ') + '}'
        : childString
    }). ` +
      'If you meant to render a collection of children, use an array ' +
      'instead.',
  );
}

function warnOnFunctionType(returnFiber: Fiber) {
  if (__DEV__) {
    const componentName = getComponentNameFromFiber(returnFiber) || 'Component';

    if (ownerHasFunctionTypeWarning[componentName]) {
      return;
    }
    ownerHasFunctionTypeWarning[componentName] = true;

    console.error(
      'Functions are not valid as a React child. This may happen if ' +
        'you return a Component instead of <Component /> from render. ' +
        'Or maybe you meant to call this function rather than return it.',
    );
  }
}

function resolveLazy(lazyType: any) {
  const payload = lazyType._payload;
  const init = lazyType._init;
  return init(payload);
}

type ChildReconciler = (
  returnFiber: Fiber,
  currentFirstChild: Fiber | null,
  newChild: any,
  lanes: Lanes,
) => Fiber | null;

// This wrapper function exists because I expect to clone the code in each path
// to be able to optimize each path individually by branching early. This needs
// a compiler or we can do it manually. Helpers that don't need this branching
// live outside of this function.
// shouldTrackSideEffects：是否追踪副作用，mountChildFibers = createChildReconciler(false),reconcileChildFibers = createChildReconciler(true)
/**
 * !  调和子节点入口函数
 * zd 主要区分是第一次渲染还是后续更新，标志位shouldTrackSideEffects:是否追踪副作用，
 *     shouldTrackSideEffects:true，也就是非第一次渲染时，会涉及到相关副作用的处理和复用
  */

function createChildReconciler(
  shouldTrackSideEffects: boolean,
): ChildReconciler {
  function deleteChild(returnFiber: Fiber, childToDelete: Fiber): void {
    if (!shouldTrackSideEffects) {
      // Noop.
      return;
    }
    const deletions = returnFiber.deletions;
    if (deletions === null) {
      returnFiber.deletions = [childToDelete];
      returnFiber.flags |= ChildDeletion;
    } else {
      deletions.push(childToDelete);
    }
  }

  function deleteRemainingChildren(
    returnFiber: Fiber,
    currentFirstChild: Fiber | null,
  ): null {
    if (!shouldTrackSideEffects) {
      // Noop.
      return null;
    }

    // TODO: For the shouldClone case, this could be micro-optimized a bit by
    // assuming that after the first child we've already added everything.
    let childToDelete = currentFirstChild;
    while (childToDelete !== null) {
      deleteChild(returnFiber, childToDelete);
      childToDelete = childToDelete.sibling;
    }
    return null;
  }

  function mapRemainingChildren(
    returnFiber: Fiber,
    currentFirstChild: Fiber,
  ): Map<string | number, Fiber> {
    // Add the remaining children to a temporary map so that we can find them by
    // keys quickly. Implicit (null) keys get added to this set with their index
    // instead.
    const existingChildren: Map<string | number, Fiber> = new Map();

    let existingChild: null | Fiber = currentFirstChild;
    while (existingChild !== null) {
      if (existingChild.key !== null) {
        existingChildren.set(existingChild.key, existingChild);
      } else {
        existingChildren.set(existingChild.index, existingChild);
      }
      existingChild = existingChild.sibling;
    }
    return existingChildren;
  }

  function useFiber(fiber: Fiber, pendingProps: mixed): Fiber {
    // We currently set sibling to null and index to 0 here because it is easy
    // to forget to do before returning it. E.g. for the single child case.
    const clone = createWorkInProgress(fiber, pendingProps);
    clone.index = 0;
    clone.sibling = null;
    return clone;
  }
  // 记录老的fiber的下标，并给新的fiber打上标记 1 2   3 3
  function placeChild(
    newFiber: Fiber,
    lastPlacedIndex: number,
    newIndex: number,
  ): number {
    newFiber.index = newIndex;
    if (!shouldTrackSideEffects) {
      // During hydration, the useId algorithm needs to know which fibers are
      // part of a list of children (arrays, iterators).
      newFiber.flags |= Forked;
      return lastPlacedIndex;
    }
    const current = newFiber.alternate;
    if (current !== null) {
      const oldIndex = current.index;//3 1  2 3
      if (oldIndex < lastPlacedIndex) {
        // This is a move.
        newFiber.flags |= Placement | PlacementDEV;
        return lastPlacedIndex;
      } else {
        // This item can stay in place.
        return oldIndex;
      }
    } else {
      // This is an insertion.
      newFiber.flags |= Placement | PlacementDEV;
      return lastPlacedIndex;
    }
  }

  function placeSingleChild(newFiber: Fiber): Fiber {
    // This is simpler for the single child case. We only need to do a
    // placement for inserting new children.
    // ! 如果是新挂载的那么就没必要记录副作用，直接返回newFiber，如果是更新的，那就需要记录副作用类型，既当前fiber需要干什么？替换？详见reactFiberFlags
    if (shouldTrackSideEffects && newFiber.alternate === null) {
      newFiber.flags |= Placement | PlacementDEV;
    }
    return newFiber;
  }

  function updateTextNode(
    returnFiber: Fiber,
    current: Fiber | null,
    textContent: string,
    lanes: Lanes,
  ) {
    if (current === null || current.tag !== HostText) {
      // Insert
      const created = createFiberFromText(textContent, returnFiber.mode, lanes);
      created.return = returnFiber;
      return created;
    } else {
      // Update
      const existing = useFiber(current, textContent);
      existing.return = returnFiber;
      return existing;
    }
  }

  function updateElement(
    returnFiber: Fiber,
    current: Fiber | null,
    element: ReactElement,
    lanes: Lanes,
  ): Fiber {
    const elementType = element.type;
    if (elementType === REACT_FRAGMENT_TYPE) {
      return updateFragment(
        returnFiber,
        current,
        element.props.children,
        lanes,
        element.key,
      );
    }
    // 更新
    if (current !== null) {
      if (
        current.elementType === elementType ||
        // Keep this check inline so it only runs on the false path:
        (__DEV__
          ? isCompatibleFamilyForHotReloading(current, element)
          : false) ||
        // Lazy types should reconcile their resolved type.
        // We need to do this after the Hot Reloading check above,
        // because hot reloading has different semantics than prod because
        // it doesn't resuspend. So we can't let the call below suspend.
        (typeof elementType === 'object' &&
          elementType !== null &&
          elementType.$$typeof === REACT_LAZY_TYPE &&
          resolveLazy(elementType) === current.type)
      ) {
        // Move based on index
        const existing = useFiber(current, element.props);
        existing.ref = coerceRef(returnFiber, current, element);
        existing.return = returnFiber;
        if (__DEV__) {
          existing._debugSource = element._source;
          existing._debugOwner = element._owner;
        }
        return existing;
      }
    }
    // Insert 新增
    const created = createFiberFromElement(element, returnFiber.mode, lanes);
    created.ref = coerceRef(returnFiber, current, element);
    created.return = returnFiber;
    return created;
  }

  function updatePortal(
    returnFiber: Fiber,
    current: Fiber | null,
    portal: ReactPortal,
    lanes: Lanes,
  ): Fiber {
    if (
      current === null ||
      current.tag !== HostPortal ||
      current.stateNode.containerInfo !== portal.containerInfo ||
      current.stateNode.implementation !== portal.implementation
    ) {
      // Insert
      const created = createFiberFromPortal(portal, returnFiber.mode, lanes);
      created.return = returnFiber;
      return created;
    } else {
      // Update
      const existing = useFiber(current, portal.children || []);
      existing.return = returnFiber;
      return existing;
    }
  }

  function updateFragment(
    returnFiber: Fiber,
    current: Fiber | null,
    fragment: Iterable<React$Node>,
    lanes: Lanes,
    key: null | string,
  ): Fiber {
    if (current === null || current.tag !== Fragment) {
      // Insert
      const created = createFiberFromFragment(
        fragment,
        returnFiber.mode,
        lanes,
        key,
      );
      created.return = returnFiber;
      return created;
    } else {
      // Update
      const existing = useFiber(current, fragment);
      existing.return = returnFiber;
      return existing;
    }
  }

  function createChild(
    returnFiber: Fiber,
    newChild: any,
    lanes: Lanes,
  ): Fiber | null {
    if (
      (typeof newChild === 'string' && newChild !== '') ||
      typeof newChild === 'number'
    ) {
      // Text nodes don't have keys. If the previous node is implicitly keyed
      // we can continue to replace it without aborting even if it is not a text
      // node.
      const created = createFiberFromText(
        '' + newChild,
        returnFiber.mode,
        lanes,
      );
      created.return = returnFiber;
      return created;
    }

    if (typeof newChild === 'object' && newChild !== null) {
      switch (newChild.$$typeof) {
        case REACT_ELEMENT_TYPE: {
          const created = createFiberFromElement(
            newChild,
            returnFiber.mode,
            lanes,
          );
          created.ref = coerceRef(returnFiber, null, newChild);
          created.return = returnFiber;
          return created;
        }
        case REACT_PORTAL_TYPE: {
          const created = createFiberFromPortal(
            newChild,
            returnFiber.mode,
            lanes,
          );
          created.return = returnFiber;
          return created;
        }
        case REACT_LAZY_TYPE: {
          const payload = newChild._payload;
          const init = newChild._init;
          return createChild(returnFiber, init(payload), lanes);
        }
      }

      if (isArray(newChild) || getIteratorFn(newChild)) {
        const created = createFiberFromFragment(
          newChild,
          returnFiber.mode,
          lanes,
          null,
        );
        created.return = returnFiber;
        return created;
      }

      // Usable node types
      //
      // Unwrap the inner value and recursively call this function again.
      if (typeof newChild.then === 'function') {
        const thenable: Thenable<any> = (newChild: any);
        return createChild(returnFiber, unwrapThenable(thenable), lanes);
      }

      if (
        newChild.$$typeof === REACT_CONTEXT_TYPE ||
        newChild.$$typeof === REACT_SERVER_CONTEXT_TYPE
      ) {
        const context: ReactContext<mixed> = (newChild: any);
        return createChild(
          returnFiber,
          readContextDuringReconcilation(returnFiber, context, lanes),
          lanes,
        );
      }

      throwOnInvalidObjectType(returnFiber, newChild);
    }

    if (__DEV__) {
      if (typeof newChild === 'function') {
        warnOnFunctionType(returnFiber);
      }
    }

    return null;
  }
  //* updateSlot 内部会判断当前的 tag 和 key 是否匹配，如果匹配复用老 fiber 形成新的 fiber ，如果不匹配，返回 null
  function updateSlot(
    returnFiber: Fiber,
    oldFiber: Fiber | null,
    newChild: any,
    lanes: Lanes,
  ): Fiber | null {
    // Update the fiber if the keys match, otherwise return null.
    const key = oldFiber !== null ? oldFiber.key : null;
    // 如果是纯文本
    if (
      (typeof newChild === 'string' && newChild !== '') ||
      typeof newChild === 'number'
    ) {
      // Text nodes don't have keys. If the previous node is implicitly keyed
      // we can continue to replace it without aborting even if it is not a text
      // node.
      if (key !== null) {
        return null;
      }
      return updateTextNode(returnFiber, oldFiber, '' + newChild, lanes);
    }

    if (typeof newChild === 'object' && newChild !== null) {
      switch (newChild.$$typeof) {
        case REACT_ELEMENT_TYPE: {
          if (newChild.key === key) {
            return updateElement(returnFiber, oldFiber, newChild, lanes);
          } else {
            return null;
          }
        }
        case REACT_PORTAL_TYPE: {
          if (newChild.key === key) {
            return updatePortal(returnFiber, oldFiber, newChild, lanes);
          } else {
            return null;
          }
        }
        case REACT_LAZY_TYPE: {
          const payload = newChild._payload;
          const init = newChild._init;
          return updateSlot(returnFiber, oldFiber, init(payload), lanes);
        }
      }

      if (isArray(newChild) || getIteratorFn(newChild)) {
        if (key !== null) {
          return null;
        }

        return updateFragment(returnFiber, oldFiber, newChild, lanes, null);
      }

      // Usable node types
      //
      // Unwrap the inner value and recursively call this function again.
      if (typeof newChild.then === 'function') {
        const thenable: Thenable<any> = (newChild: any);
        return updateSlot(
          returnFiber,
          oldFiber,
          unwrapThenable(thenable),
          lanes,
        );
      }

      if (
        newChild.$$typeof === REACT_CONTEXT_TYPE ||
        newChild.$$typeof === REACT_SERVER_CONTEXT_TYPE
      ) {
        const context: ReactContext<mixed> = (newChild: any);
        return updateSlot(
          returnFiber,
          oldFiber,
          readContextDuringReconcilation(returnFiber, context, lanes),
          lanes,
        );
      }

      throwOnInvalidObjectType(returnFiber, newChild);
    }

    if (__DEV__) {
      if (typeof newChild === 'function') {
        warnOnFunctionType(returnFiber);
      }
    }

    return null;
  }

  function updateFromMap(
    existingChildren: Map<string | number, Fiber>,
    returnFiber: Fiber,
    newIdx: number,
    newChild: any,
    lanes: Lanes,
  ): Fiber | null {
    if (
      (typeof newChild === 'string' && newChild !== '') ||
      typeof newChild === 'number'
    ) {
      // Text nodes don't have keys, so we neither have to check the old nor
      // new node for the key. If both are text nodes, they match.
      const matchedFiber = existingChildren.get(newIdx) || null;
      return updateTextNode(returnFiber, matchedFiber, '' + newChild, lanes);
    }

    if (typeof newChild === 'object' && newChild !== null) {
      switch (newChild.$$typeof) {
        case REACT_ELEMENT_TYPE: {
          const matchedFiber =
            existingChildren.get(
              newChild.key === null ? newIdx : newChild.key,
            ) || null;
          return updateElement(returnFiber, matchedFiber, newChild, lanes);
        }
        case REACT_PORTAL_TYPE: {
          const matchedFiber =
            existingChildren.get(
              newChild.key === null ? newIdx : newChild.key,
            ) || null;
          return updatePortal(returnFiber, matchedFiber, newChild, lanes);
        }
        case REACT_LAZY_TYPE:
          const payload = newChild._payload;
          const init = newChild._init;
          return updateFromMap(
            existingChildren,
            returnFiber,
            newIdx,
            init(payload),
            lanes,
          );
      }

      if (isArray(newChild) || getIteratorFn(newChild)) {
        const matchedFiber = existingChildren.get(newIdx) || null;
        return updateFragment(returnFiber, matchedFiber, newChild, lanes, null);
      }

      // Usable node types
      //
      // Unwrap the inner value and recursively call this function again.
      if (typeof newChild.then === 'function') {
        const thenable: Thenable<any> = (newChild: any);
        return updateFromMap(
          existingChildren,
          returnFiber,
          newIdx,
          unwrapThenable(thenable),
          lanes,
        );
      }

      if (
        newChild.$$typeof === REACT_CONTEXT_TYPE ||
        newChild.$$typeof === REACT_SERVER_CONTEXT_TYPE
      ) {
        const context: ReactContext<mixed> = (newChild: any);
        return updateFromMap(
          existingChildren,
          returnFiber,
          newIdx,
          readContextDuringReconcilation(returnFiber, context, lanes),
          lanes,
        );
      }

      throwOnInvalidObjectType(returnFiber, newChild);
    }

    if (__DEV__) {
      if (typeof newChild === 'function') {
        warnOnFunctionType(returnFiber);
      }
    }

    return null;
  }

  /**
   * Warns if there is a duplicate or missing key
   */
  function warnOnInvalidKey(
    child: mixed,
    knownKeys: Set<string> | null,
    returnFiber: Fiber,
  ): Set<string> | null {
    if (__DEV__) {
      if (typeof child !== 'object' || child === null) {
        return knownKeys;
      }
      switch (child.$$typeof) {
        case REACT_ELEMENT_TYPE:
        case REACT_PORTAL_TYPE:
          warnForMissingKey(child, returnFiber);
          const key = child.key;
          if (typeof key !== 'string') {
            break;
          }
          if (knownKeys === null) {
            knownKeys = new Set();
            knownKeys.add(key);
            break;
          }
          if (!knownKeys.has(key)) {
            knownKeys.add(key);
            break;
          }
          console.error(
            'Encountered two children with the same key, `%s`. ' +
              'Keys should be unique so that components maintain their identity ' +
              'across updates. Non-unique keys may cause children to be ' +
              'duplicated and/or omitted — the behavior is unsupported and ' +
              'could change in a future version.',
            key,
          );
          break;
        case REACT_LAZY_TYPE:
          const payload = child._payload;
          const init = (child._init: any);
          warnOnInvalidKey(init(payload), knownKeys, returnFiber);
          break;
        default:
          break;
      }
    }
    return knownKeys;
  }
  // ! diff入口，1|多 （旧）--对--》多（新）
  function reconcileChildrenArray(
    returnFiber: Fiber,
    currentFirstChild: Fiber | null,
    newChildren: Array<any>,
    lanes: Lanes,
  ): Fiber | null {
    // This algorithm can't optimize by searching from both ends since we
    // don't have backpointers on fibers. I'm trying to see how far we can get
    // with that model. If it ends up not being worth the tradeoffs, we can
    // add it later.

    // Even with a two ended optimization, we'd want to optimize for the case
    // where there are few changes and brute force the comparison instead of
    // going for the Map. It'd like to explore hitting that path first in
    // forward-only mode and only go for the Map once we notice that we need
    // lots of look ahead. This doesn't handle reversal as well as two ended
    // search but that's unusual. Besides, for the two ended optimization to
    // work on Iterables, we'd need to copy the whole set.

    // In this first iteration, we'll just live with hitting the bad case
    // (adding everything to a Map) in for every insert/move.

    // If you change this code, also update reconcileChildrenIterator() which
    // uses the same algorithm.

    if (__DEV__) {
      // First, validate keys.
      let knownKeys: Set<string> | null = null;
      for (let i = 0; i < newChildren.length; i++) {
        const child = newChildren[i];
        knownKeys = warnOnInvalidKey(child, knownKeys, returnFiber);
      }
    }
    // * 要返回的第一个子fiber节点
    let resultingFirstChild: Fiber | null = null;
    let previousNewFiber: Fiber | null = null;

    let oldFiber = currentFirstChild;
    let lastPlacedIndex = 0;
    let newIdx = 0;
    let nextOldFiber = null;
    /*
    ! 第一步： zd 对于 React.createElement 产生新的 child 组成的数组，首先会遍历数组，
    *                 因为 fiber 对于同一级兄弟节点是用 sibling 指针指向，所以在遍历children 遍历，sibling 指针同时移动，找到与 child 对应的 oldFiber 。
                      旧:  ABCD 新：ABEFG  第一步就是尽可能多的找到能服用的。
    * */
    for (; oldFiber !== null && newIdx < newChildren.length; newIdx++) {
      if (oldFiber.index > newIdx) {
        nextOldFiber = oldFiber;
        oldFiber = null;
      } else {
        nextOldFiber = oldFiber.sibling;
      }
      const newFiber = updateSlot(
        returnFiber,
        oldFiber,
        newChildren[newIdx],
        lanes,
      );
      // ?如果为null则说明不可复用，退出第一轮循环
      if (newFiber === null) {
        // TODO: This breaks on empty slots like null children. That's
        // unfortunate because it triggers the slow path all the time. We need
        // a better way to communicate whether this was a miss or null,
        // boolean, undefined, etc.
        if (oldFiber === null) {
          oldFiber = nextOldFiber;
        }
        break;
      }
      //为更新流程。
      if (shouldTrackSideEffects) {
        //找到与新节点对应的老fiber，但是不能复用(新创建的？？)
        if (oldFiber && newFiber.alternate === null) {
          // We matched the slot, but we didn't reuse the existing fiber, so we
          // need to delete the existing child.
          deleteChild(returnFiber, oldFiber);
        }
      }
      // 记录老的fiber的下标，并打上PlaceMent标记
      lastPlacedIndex = placeChild(newFiber, lastPlacedIndex, newIdx);
      if (previousNewFiber === null) {
        // TODO: Move out of the loop. This only happens for the first run.
        resultingFirstChild = newFiber;
      } else {
        // TODO: Defer siblings if we're not at the right index for this slot.
        // I.e. if we had null values before, then we want to defer this
        // for each null value. However, we also don't want to call updateSlot
        // with the previous one.
        previousNewFiber.sibling = newFiber;
      }
      // 继续处理其他兄弟节点
      previousNewFiber = newFiber;
      oldFiber = nextOldFiber;
    }
    /*
    * 第一轮结束，有以下集中可能
    *   1、newChildren 都遍历完了，那么剩下的oldFiber都是需要删除的，那就给剩下的fiber添加Deletions标记。------>第二步
    *   2、若oldChildren遍历完毕，那么说明剩下的newFiber都是需要新增的，----> 第三步
    *   3、若oldFiber和newChildren都未遍历完 ，那么就来到了核心地方，需要挨个比对，找出能复用的复用，找不到复用的就心急啊，不能复用的旧节点删除、 ---->第四步
    * */
    /*
     ! 第二步：zd 统一删除oldFiber节点，适用于第一步结束完，newIndex = newChildren.length ,此时证明所有newChild已经比那里完成，那么剩下没有
                         遍历到的oldFilber也没啥用了，调用deleteRemainingChildren统一删除剩余的oldFiber。
                         e.g. 新子节点遍历完了，那么就删除多余的老节点。old:ABCD   new AB,这回删除CD
    * */
    if (newIdx === newChildren.length) {
      // We've reached the end of the new children. We can delete the rest.
      deleteRemainingChildren(returnFiber, oldFiber);
      if (getIsHydrating()) {
        const numberOfForks = newIdx;
        pushTreeFork(returnFiber, numberOfForks);
      }
      return resultingFirstChild;
    }
    /*
    ! 第三步：zd 统一创建newFiber,适用于第一步遍历完成，oldFiber为null，证明oldFiber复用完毕。如果还有新的children，说明都是新的元素
                        只需要调用createChild创建新的fiber。e.g.  旧：AB,  新：ABCDE，那么就要添加CDE
    * */
    if (oldFiber === null) {
      // If we don't have any more existing children we can choose a fast path
      // since the rest will all be insertions.
      for (; newIdx < newChildren.length; newIdx++) {
        const newFiber = createChild(returnFiber, newChildren[newIdx], lanes);
        if (newFiber === null) {
          continue;
        }
        lastPlacedIndex = placeChild(newFiber, lastPlacedIndex, newIdx);
        //如果前置节点不存在，说明全新的child  比如old:null,新的：ABCD
        /*1、把返回子节点的首个节点指向第一个（A），然后前置节点(previousNewFiber)指向当前遍历的newFiber（A）
          2、此时previousNewFiber存在，就把previousNewFiber（A）的slibing指向B,然后前置节点指针指向B节点，
          3、previousNewFiber（B）的slibing指向C,然后前置节点指针指向C节点，
          4、previousNewFiber（C）的slibing指向D,然后前置节点指针指向D节点，
          返回子节点的首个节点，因为父节点的child指向该节点。
        *
        * */
        if (previousNewFiber === null) {
          // TODO: Move out of the loop. This only happens for the first run.
          resultingFirstChild = newFiber;
        } else {
          previousNewFiber.sibling = newFiber;
        }
        previousNewFiber = newFiber;
      }
      if (getIsHydrating()) {
        const numberOfForks = newIdx;
        pushTreeFork(returnFiber, numberOfForks);
      }
      return resultingFirstChild;
    }
    /*
    ! 第四步：zd 针对发生移动和更复杂的情况;key不能用下下标的原因在于，如果元素发说说移动，那么从移动节点开始，接下来的fiber都不能得到合理的利用；index+'字段'同理不行。
                       oldChild:ABCD ,newChild: ABDC,如上，AB在第一步被复用，第二步和第三步不符合，直接进行第四步，C  D被全完复用，existingChildren为空
    * */
    // Add all children to a key map for quick lookups.
    //* 生成一个老fiber和对应的key（或者index）的映射关系，为了快速寻找
    const existingChildren = mapRemainingChildren(returnFiber, oldFiber);

    // * 处理剩下的newChildren ，判断existingChildren是否有可以复用的oldFiber，有，就复用；无，新建一个newFiber
    // Keep scanning and use the map to restore deleted items as moves.
    for (; newIdx < newChildren.length; newIdx++) {
      // ?若找到则基于 oldFiber 和 newChild 的 props创建，否则直接基于 newChild 创建
      const newFiber = updateFromMap(
        existingChildren,
        returnFiber,
        newIdx,
        newChildren[newIdx],
        lanes,
      );
      // 如果有可复用的旧节点
      if (newFiber !== null) {
        // 是更新操作
        if (shouldTrackSideEffects) {
          if (newFiber.alternate !== null) {
            // The new fiber is a work in progress, but if there exists a
            // current, that means that we reused the fiber. We need to delete
            // it from the child list so that we don't add it to the deletion
            // list.
            //oldFiber如果 被复用，就从existIngChildren中把它删除。
            existingChildren.delete(
              newFiber.key === null ? newIdx : newFiber.key,
            );
          }
        }
        // 1 2
        // 处理移动的情况，给移动的节点加上新增标记，插入到fiber链表树当中 比如当前的例子，
        // 遍历到D时，传入，Fiber(D),1,2 因为旧的D坐标是3>1(lastplaceIndex).所以不用移动返回旧的坐标3，并赋值给lastplaceIndex
        // 遍历到C的时候，传入Fiber(C),3,3,因为旧C的坐标是2<3(lastplaceIndex),所以返回lastplaceIndex，并标记该元素是需要移动的。
        // e.g. ABCDEFGH   ->   BCEDJGH          if (oldIndex < lastPlacedIndex) {
        //         // This is a move.
        //         newFiber.flags |= Placement | PlacementDEV;
        //         return lastPlacedIndex;
        //       } else {
        //         // This item can stay in place.
        //         return oldIndex;
        //       }
        // 0,0,   1>0   ->1 n
        // 1,1   2>1  ->2  n
        //2,2   4>2   ->4  n
        //4,3   3<4   ->4  y
        //4.4   不存在oldindex ->4 n 新增J
        //4,5  6>4   ->6  n
        //6,6  7>6  ->7  n
        //删除A 、E
        lastPlacedIndex = placeChild(newFiber, lastPlacedIndex, newIdx);
        if (previousNewFiber === null) {
          resultingFirstChild = newFiber;
        } else {
          previousNewFiber.sibling = newFiber;
        }
        previousNewFiber = newFiber;
      }
    }
    /*
     ! 第五步 zd 删除剩余没有复用的oldFiber ; e.g. oldChildren:ABCD,newChildren :AEDB, 首先A节点在第一步的时候已经被复用，接下来直接走到了第四步，遍历newChildren
                    E被创建，DB从existingChildren中被复用，existingChildren还剩下一个C，在第五步，就会删除这个C，完成整个流程

    * */
    if (shouldTrackSideEffects) {
      // Any existing children that weren't consumed above were deleted. We need
      // to add them to the deletion list.
      existingChildren.forEach(child => deleteChild(returnFiber, child));
    }

    if (getIsHydrating()) {
      const numberOfForks = newIdx;
      pushTreeFork(returnFiber, numberOfForks);
    }
    return resultingFirstChild;
  }

  function reconcileChildrenIterator(
    returnFiber: Fiber,
    currentFirstChild: Fiber | null,
    newChildrenIterable: Iterable<mixed>,
    lanes: Lanes,
  ): Fiber | null {
    // This is the same implementation as reconcileChildrenArray(),
    // but using the iterator instead.

    const iteratorFn = getIteratorFn(newChildrenIterable);

    if (typeof iteratorFn !== 'function') {
      throw new Error(
        'An object is not an iterable. This error is likely caused by a bug in ' +
          'React. Please file an issue.',
      );
    }

    if (__DEV__) {
      // We don't support rendering Generators because it's a mutation.
      // See https://github.com/facebook/react/issues/12995
      if (
        typeof Symbol === 'function' &&
        // $FlowFixMe Flow doesn't know about toStringTag
        newChildrenIterable[Symbol.toStringTag] === 'Generator'
      ) {
        if (!didWarnAboutGenerators) {
          console.error(
            'Using Generators as children is unsupported and will likely yield ' +
              'unexpected results because enumerating a generator mutates it. ' +
              'You may convert it to an array with `Array.from()` or the ' +
              '`[...spread]` operator before rendering. Keep in mind ' +
              'you might need to polyfill these features for older browsers.',
          );
        }
        didWarnAboutGenerators = true;
      }

      // Warn about using Maps as children
      if ((newChildrenIterable: any).entries === iteratorFn) {
        if (!didWarnAboutMaps) {
          console.error(
            'Using Maps as children is not supported. ' +
              'Use an array of keyed ReactElements instead.',
          );
        }
        didWarnAboutMaps = true;
      }

      // First, validate keys.
      // We'll get a different iterator later for the main pass.
      const newChildren = iteratorFn.call(newChildrenIterable);
      if (newChildren) {
        let knownKeys: Set<string> | null = null;
        let step = newChildren.next();
        for (; !step.done; step = newChildren.next()) {
          const child = step.value;
          knownKeys = warnOnInvalidKey(child, knownKeys, returnFiber);
        }
      }
    }

    const newChildren = iteratorFn.call(newChildrenIterable);

    if (newChildren == null) {
      throw new Error('An iterable object provided no iterator.');
    }

    let resultingFirstChild: Fiber | null = null;
    let previousNewFiber: Fiber | null = null;

    let oldFiber = currentFirstChild;
    let lastPlacedIndex = 0;
    let newIdx = 0;
    let nextOldFiber = null;

    let step = newChildren.next();
    for (
      ;
      oldFiber !== null && !step.done;
      newIdx++, step = newChildren.next()
    ) {
      if (oldFiber.index > newIdx) {
        nextOldFiber = oldFiber;
        oldFiber = null;
      } else {
        nextOldFiber = oldFiber.sibling;
      }
      const newFiber = updateSlot(returnFiber, oldFiber, step.value, lanes);
      if (newFiber === null) {
        // TODO: This breaks on empty slots like null children. That's
        // unfortunate because it triggers the slow path all the time. We need
        // a better way to communicate whether this was a miss or null,
        // boolean, undefined, etc.
        if (oldFiber === null) {
          oldFiber = nextOldFiber;
        }
        break;
      }
      if (shouldTrackSideEffects) {
        if (oldFiber && newFiber.alternate === null) {
          // We matched the slot, but we didn't reuse the existing fiber, so we
          // need to delete the existing child.
          deleteChild(returnFiber, oldFiber);
        }
      }
      lastPlacedIndex = placeChild(newFiber, lastPlacedIndex, newIdx);
      if (previousNewFiber === null) {
        // TODO: Move out of the loop. This only happens for the first run.
        resultingFirstChild = newFiber;
      } else {
        // TODO: Defer siblings if we're not at the right index for this slot.
        // I.e. if we had null values before, then we want to defer this
        // for each null value. However, we also don't want to call updateSlot
        // with the previous one.
        previousNewFiber.sibling = newFiber;
      }
      previousNewFiber = newFiber;
      oldFiber = nextOldFiber;
    }

    if (step.done) {
      // We've reached the end of the new children. We can delete the rest.
      deleteRemainingChildren(returnFiber, oldFiber);
      if (getIsHydrating()) {
        const numberOfForks = newIdx;
        pushTreeFork(returnFiber, numberOfForks);
      }
      return resultingFirstChild;
    }

    if (oldFiber === null) {
      // If we don't have any more existing children we can choose a fast path
      // since the rest will all be insertions.
      for (; !step.done; newIdx++, step = newChildren.next()) {
        const newFiber = createChild(returnFiber, step.value, lanes);
        if (newFiber === null) {
          continue;
        }
        lastPlacedIndex = placeChild(newFiber, lastPlacedIndex, newIdx);
        if (previousNewFiber === null) {
          // TODO: Move out of the loop. This only happens for the first run.
          resultingFirstChild = newFiber;
        } else {
          previousNewFiber.sibling = newFiber;
        }
        previousNewFiber = newFiber;
      }
      if (getIsHydrating()) {
        const numberOfForks = newIdx;
        pushTreeFork(returnFiber, numberOfForks);
      }
      return resultingFirstChild;
    }

    // Add all children to a key map for quick lookups.
    const existingChildren = mapRemainingChildren(returnFiber, oldFiber);

    // Keep scanning and use the map to restore deleted items as moves.
    for (; !step.done; newIdx++, step = newChildren.next()) {
      const newFiber = updateFromMap(
        existingChildren,
        returnFiber,
        newIdx,
        step.value,
        lanes,
      );
      if (newFiber !== null) {
        if (shouldTrackSideEffects) {
          if (newFiber.alternate !== null) {
            // The new fiber is a work in progress, but if there exists a
            // current, that means that we reused the fiber. We need to delete
            // it from the child list so that we don't add it to the deletion
            // list.
            existingChildren.delete(
              newFiber.key === null ? newIdx : newFiber.key,
            );
          }
        }
        lastPlacedIndex = placeChild(newFiber, lastPlacedIndex, newIdx);
        if (previousNewFiber === null) {
          resultingFirstChild = newFiber;
        } else {
          previousNewFiber.sibling = newFiber;
        }
        previousNewFiber = newFiber;
      }
    }

    if (shouldTrackSideEffects) {
      // Any existing children that weren't consumed above were deleted. We need
      // to add them to the deletion list.
      existingChildren.forEach(child => deleteChild(returnFiber, child));
    }

    if (getIsHydrating()) {
      const numberOfForks = newIdx;
      pushTreeFork(returnFiber, numberOfForks);
    }
    return resultingFirstChild;
  }

  /*
  * 创建文本fiber
  * */
  function reconcileSingleTextNode(
    returnFiber: Fiber,
    currentFirstChild: Fiber | null,
    textContent: string,
    lanes: Lanes,
  ): Fiber {
    // There's no need to check for keys on text nodes since we don't have a
    // way to define them.
    //第一个子节点为文本类型
    if (currentFirstChild !== null && currentFirstChild.tag === HostText) {
      // We already have an existing node so let's just update it and delete
      // the rest.
      deleteRemainingChildren(returnFiber, currentFirstChild.sibling);
      const existing = useFiber(currentFirstChild, textContent);
      existing.return = returnFiber;
      return existing;
    }
    //非文本类型打上标记，创建新的文本类型节点
    // The existing first child is not a text node so we need to create one
    // and delete the existing ones.
    deleteRemainingChildren(returnFiber, currentFirstChild);
    const created = createFiberFromText(textContent, returnFiber.mode, lanes);
    created.return = returnFiber;
    return created;
  }

  /*
  ! 1对1 或者 多对1
  * 针对newChild 是新节点，而oldChild是单节点或者是多节点就无法确定了，所以会先对oldChild进行遍历，然后删除不匹配的oldFiber
  * zd 1.通过child和slibing遍历renturnFiber的所有孩子fiber，检查key&&type是否命中，
          a、如果旧节点的key与新生成fiber的key不一致，给当前旧节点添加Deletions标记，继续遍历兄弟节点
          b、如果新旧节点key值一样，那就会根据当前节点的type分别去处理，如果type匹配上，就会用useFier复用节点，然后给当前子节点及其剩余节点添加Deletions标记，并跳出循环
                如果type匹配不上，则会直接给旧的fiber子节点打上Deletion标记，移除子节点以及后面的所有兄弟节点。
          2、如果旧的节点遍历完成，并没有找到匹配的节点，那么就会根据新节点类型去创建对应的Fiber, 并将returnFiber赋值给这个新的fiber的return字段，然后返回新的fiber
  * @element：其实就是我们写的class  function Compoent 经过createElement执行之后生成的ReactElement
     @renturnFiber 父级 @currentFirstChild 父级下的第一个子节点
  * */
  function reconcileSingleElement(
    returnFiber: Fiber,
    currentFirstChild: Fiber | null,
    element: ReactElement,
    lanes: Lanes,
  ): Fiber {
    const key = element.key;
    let child = currentFirstChild;
    while (child !== null) {
      // TODO: If key === null and child.key === null, then this only applies to
      // the first item in the list.
      if (child.key === key) {
        const elementType = element.type;
        if (elementType === REACT_FRAGMENT_TYPE) {
          if (child.tag === Fragment) {
            //? 如果节点是Fragment类型，那么从returnFiber 中删除currentFirstChild及之后的所有兄弟fiber
            deleteRemainingChildren(returnFiber, child.sibling);
            //通过useFiber 以旧的fiber为模板，新的propsChildren 合并生成新的fiber
            const existing = useFiber(child, element.props.children);
            existing.return = returnFiber;
            if (__DEV__) {
              existing._debugSource = element._source;
              existing._debugOwner = element._owner;
            }
            return existing;
          }
        } else {
          if (
            child.elementType === elementType ||
            // Keep this check inline so it only runs on the false path:
            (__DEV__
              ? isCompatibleFamilyForHotReloading(child, element)
              : false) ||
            // Lazy types should reconcile their resolved type.
            // We need to do this after the Hot Reloading check above,
            // because hot reloading has different semantics than prod because
            // it doesn't resuspend. So we can't let the call below suspend.
            (typeof elementType === 'object' &&
              elementType !== null &&
              elementType.$$typeof === REACT_LAZY_TYPE &&
              resolveLazy(elementType) === child.type)
          ) {
            deleteRemainingChildren(returnFiber, child.sibling);
            const existing = useFiber(child, element.props);
            existing.ref = coerceRef(returnFiber, child, element);
            existing.return = returnFiber;
            if (__DEV__) {
              existing._debugSource = element._source;
              existing._debugOwner = element._owner;
            }
            return existing;
          }
        }
        // Didn't match.
        deleteRemainingChildren(returnFiber, child);
        break;
      } else {
        deleteChild(returnFiber, child);
      }
      child = child.sibling;
    }

    if (element.type === REACT_FRAGMENT_TYPE) {
      const created = createFiberFromFragment(
        element.props.children,
        returnFiber.mode,
        lanes,
        element.key,
      );
      created.return = returnFiber;
      return created;
    } else {
      const created = createFiberFromElement(element, returnFiber.mode, lanes);
      created.ref = coerceRef(returnFiber, currentFirstChild, element);
      created.return = returnFiber;
      return created;
    }
  }

  function reconcileSinglePortal(
    returnFiber: Fiber,
    currentFirstChild: Fiber | null,
    portal: ReactPortal,
    lanes: Lanes,
  ): Fiber {
    const key = portal.key;
    let child = currentFirstChild;
    while (child !== null) {
      // TODO: If key === null and child.key === null, then this only applies to
      // the first item in the list.
      if (child.key === key) {
        if (
          child.tag === HostPortal &&
          child.stateNode.containerInfo === portal.containerInfo &&
          child.stateNode.implementation === portal.implementation
        ) {
          deleteRemainingChildren(returnFiber, child.sibling);
          const existing = useFiber(child, portal.children || []);
          existing.return = returnFiber;
          return existing;
        } else {
          deleteRemainingChildren(returnFiber, child);
          break;
        }
      } else {
        deleteChild(returnFiber, child);
      }
      child = child.sibling;
    }

    const created = createFiberFromPortal(portal, returnFiber.mode, lanes);
    created.return = returnFiber;
    return created;
  }

  // This API will tag the children with the side-effect of the reconciliation
  // itself. They will be added to the side-effect list as we pass through the
  // children and the parent.
  function reconcileChildFibersImpl(
    returnFiber: Fiber,
    currentFirstChild: Fiber | null,
    newChild: any,
    lanes: Lanes,
  ): Fiber | null {
    // This function is not recursive.
    // If the top level item is an array, we treat it as a set of children,
    // not as a fragment. Nested arrays on the other hand will be treated as
    // fragment nodes. Recursion happens at the normal flow.

    // Handle top level unkeyed fragments as if they were arrays.
    // This leads to an ambiguity between <>{[...]}</> and <>...</>.
    // We treat the ambiguous cases above the same.
    // TODO: Let's use recursion like we do for Usable nodes?
    // !新节点是顶层序fragment。我们对他进行格式化（当成数组来处理），然后就可以统一处理了
    const isUnkeyedTopLevelFragment =
      typeof newChild === 'object' &&
      newChild !== null &&
      newChild.type === REACT_FRAGMENT_TYPE &&
      newChild.key === null;
    if (isUnkeyedTopLevelFragment) {
      newChild = newChild.props.children;
    }

    // Handle object types
    if (typeof newChild === 'object' && newChild !== null) {
      switch (newChild.$$typeof) {
        // 元素类型
        case REACT_ELEMENT_TYPE:
          // * 此处placeSingleChild 是为了改变flags
          return placeSingleChild(
            reconcileSingleElement(
              returnFiber,
              currentFirstChild,
              newChild,
              lanes,
            ),
          );
        case REACT_PORTAL_TYPE:
          return placeSingleChild(
            reconcileSinglePortal(
              returnFiber,
              currentFirstChild,
              newChild,
              lanes,
            ),
          );
        case REACT_LAZY_TYPE:
          const payload = newChild._payload;
          const init = newChild._init;
          // TODO: This function is supposed to be non-recursive.
          return reconcileChildFibers(
            returnFiber,
            currentFirstChild,
            init(payload),
            lanes,
          );
      }
      // !子节点是数组类型 1对多（新）或者多对多
      if (isArray(newChild)) {
        return reconcileChildrenArray(
          returnFiber,
          currentFirstChild,
          newChild,
          lanes,
        );
      }
      // ! 子节点是可迭代对象
      if (getIteratorFn(newChild)) {
        return reconcileChildrenIterator(
          returnFiber,
          currentFirstChild,
          newChild,
          lanes,
        );
      }

      // Usables are a valid React node type. When React encounters a Usable in
      // a child position, it unwraps it using the same algorithm as `use`. For
      // example, for promises, React will throw an exception to unwind the
      // stack, then replay the component once the promise resolves.
      //
      // A difference from `use` is that React will keep unwrapping the value
      // until it reaches a non-Usable type.
      //
      // e.g. Usable<Usable<Usable<T>>> should resolve to T
      //
      // The structure is a bit unfortunate. Ideally, we shouldn't need to
      // replay the entire begin phase of the parent fiber in order to reconcile
      // the children again. This would require a somewhat significant refactor,
      // because reconcilation happens deep within the begin phase, and
      // depending on the type of work, not always at the end. We should
      // consider as an future improvement.
      if (typeof newChild.then === 'function') {
        const thenable: Thenable<any> = (newChild: any);
        return reconcileChildFibersImpl(
          returnFiber,
          currentFirstChild,
          unwrapThenable(thenable),
          lanes,
        );
      }

      if (
        newChild.$$typeof === REACT_CONTEXT_TYPE ||
        newChild.$$typeof === REACT_SERVER_CONTEXT_TYPE
      ) {
        const context: ReactContext<mixed> = (newChild: any);
        return reconcileChildFibersImpl(
          returnFiber,
          currentFirstChild,
          readContextDuringReconcilation(returnFiber, context, lanes),
          lanes,
        );
      }

      throwOnInvalidObjectType(returnFiber, newChild);
    }
    // ! 新节点是文本节点
    if (
      (typeof newChild === 'string' && newChild !== '') ||
      typeof newChild === 'number'
    ) {
      return placeSingleChild(
        reconcileSingleTextNode(
          returnFiber,
          currentFirstChild,
          '' + newChild,
          lanes,
        ),
      );
    }

    if (__DEV__) {
      if (typeof newChild === 'function') {
        warnOnFunctionType(returnFiber);
      }
    }

    // Remaining cases are all treated as empty.
    return deleteRemainingChildren(returnFiber, currentFirstChild);
  }

  function reconcileChildFibers(
    returnFiber: Fiber,
    currentFirstChild: Fiber | null,
    newChild: any,
    lanes: Lanes,
  ): Fiber | null {
    // This indirection only exists so we can reset `thenableState` at the end.
    // It should get inlined by Closure.
    thenableIndexCounter = 0;
    //*调节子节点具体的操作了
    const firstChildFiber = reconcileChildFibersImpl(
      returnFiber,
      currentFirstChild,
      newChild,
      lanes,
    );
    thenableState = null;
    // Don't bother to reset `thenableIndexCounter` to 0 because it always gets
    // set at the beginning.
    return firstChildFiber;
  }

  return reconcileChildFibers;
}

export const reconcileChildFibers: ChildReconciler =
  createChildReconciler(true);
export const mountChildFibers: ChildReconciler = createChildReconciler(false);

export function resetChildReconcilerOnUnwind(): void {
  // On unwind, clear any pending thenables that were used.
  thenableState = null;
  thenableIndexCounter = 0;
}

export function cloneChildFibers(
  current: Fiber | null,
  workInProgress: Fiber,
): void {
  if (current !== null && workInProgress.child !== current.child) {
    throw new Error('Resuming work not yet implemented.');
  }

  if (workInProgress.child === null) {
    return;
  }

  let currentChild = workInProgress.child;
  let newChild = createWorkInProgress(currentChild, currentChild.pendingProps);
  workInProgress.child = newChild;

  newChild.return = workInProgress;
  while (currentChild.sibling !== null) {
    currentChild = currentChild.sibling;
    newChild = newChild.sibling = createWorkInProgress(
      currentChild,
      currentChild.pendingProps,
    );
    newChild.return = workInProgress;
  }
  newChild.sibling = null;
}

// Reset a workInProgress child set to prepare it for a second pass.
export function resetChildFibers(workInProgress: Fiber, lanes: Lanes): void {
  let child = workInProgress.child;
  while (child !== null) {
    resetWorkInProgress(child, lanes);
    child = child.sibling;
  }
}
