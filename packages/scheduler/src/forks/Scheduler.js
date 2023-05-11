/**
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 *
 * @flow
 */

/* eslint-disable no-var */

import type {PriorityLevel} from '../SchedulerPriorities';

import {
  enableSchedulerDebugging,
  enableProfiling,
  enableIsInputPending,
  enableIsInputPendingContinuous,
  frameYieldMs,
  continuousYieldMs,
  maxYieldMs,
} from '../SchedulerFeatureFlags';

import {push, pop, peek} from '../SchedulerMinHeap';

// TODO: Use symbols?
import {
  ImmediatePriority,
  UserBlockingPriority,
  NormalPriority,
  LowPriority,
  IdlePriority,
} from '../SchedulerPriorities';
import {
  markTaskRun,
  markTaskYield,
  markTaskCompleted,
  markTaskCanceled,
  markTaskErrored,
  markSchedulerSuspended,
  markSchedulerUnsuspended,
  markTaskStart,
  stopLoggingProfilingEvents,
  startLoggingProfilingEvents,
} from '../SchedulerProfiling';

export type Callback = boolean => ?Callback;
/*
! id: 唯一标识
callback: task 最核心的字段, 指向react-reconciler包所提供的回调函数.
priorityLevel: 优先级
startTime: 一个时间戳,代表 task 的开始时间(创建时间 + 延时时间).
expirationTime: 过期时间.
sortIndex: 控制 task 在队列中的次序, 值越小的越靠前.
? 注意task 中没有next属性，他不是一个链表，其顺序是通过堆排序来实现的（小顶堆数组，始终保持数组中的第一个task对象最高优先级）
*/
type Task = {
  id: number,
  callback: Callback | null,
  priorityLevel: PriorityLevel,
  startTime: number,
  expirationTime: number,
  sortIndex: number,
  isQueued?: boolean,
};

let getCurrentTime: () => number | DOMHighResTimeStamp;
const hasPerformanceNow =
  // $FlowFixMe[method-unbinding]
  typeof performance === 'object' && typeof performance.now === 'function';

if (hasPerformanceNow) {
  const localPerformance = performance;
  getCurrentTime = () => localPerformance.now();
} else {
  const localDate = Date;
  const initialTime = localDate.now();
  getCurrentTime = () => localDate.now() - initialTime;
}

// Max 31 bit integer. The max integer size in V8 for 32-bit systems.
// Math.pow(2, 30) - 1
// 0b111111111111111111111111111111
var maxSigned31BitInt = 1073741823;

// Times out immediately
var IMMEDIATE_PRIORITY_TIMEOUT = -1;
// Eventually times out
//一般指的是用户交互
var USER_BLOCKING_PRIORITY_TIMEOUT = 250;
//不需要直观立即变化的任务，比如网络请求
var NORMAL_PRIORITY_TIMEOUT = 5000;
//肯定要执行的任务，但是可以放在最后处理
var LOW_PRIORITY_TIMEOUT = 10000;
// Never times out
//一些没有必要的任务，可能不会执行
var IDLE_PRIORITY_TIMEOUT = maxSigned31BitInt;

// Tasks are stored on a min heap
// 里面存的都是即将执行的（过期的）任务，依据任务的过期时间（expirationTime）排序，需要在调度的workLoop中循环执行完这些任务
var taskQueue: Array<Task> = [];
//存储的都是延期执行的任务，依据任务的开始时间（startTime）排序，在调度workLoop中会用advanceTimers检查任务是否过期，如果过期了，放入taskQueue队列
var timerQueue: Array<Task> = [];

// Incrementing id counter. Used to maintain insertion order.
var taskIdCounter = 1;

// Pausing the scheduler is useful for debugging.
var isSchedulerPaused = false;

var currentTask = null;
var currentPriorityLevel = NormalPriority;

// This is set while performing work, to prevent re-entrance.
// 正在干活的标志
var isPerformingWork = false;
// 主线程回调已安排
var isHostCallbackScheduled = false;
// 有延时任务
var isHostTimeoutScheduled = false;

// Capture local references to native APIs, in case a polyfill overrides them.
const localSetTimeout = typeof setTimeout === 'function' ? setTimeout : null;
const localClearTimeout =
  typeof clearTimeout === 'function' ? clearTimeout : null;
const localSetImmediate =
  typeof setImmediate !== 'undefined' ? setImmediate : null; // IE and Node.js + jsdom

const isInputPending =
  typeof navigator !== 'undefined' &&
  // $FlowFixMe[prop-missing]
  navigator.scheduling !== undefined &&
  // $FlowFixMe[incompatible-type]
  navigator.scheduling.isInputPending !== undefined
    ? navigator.scheduling.isInputPending.bind(navigator.scheduling)
    : null;

const continuousOptions = {includeContinuous: enableIsInputPendingContinuous};

// 根据当前时间检查timerQueue里面已经过期的任务，并把他们转移至taskQueue
function advanceTimers(currentTime: number) {
  // Check for tasks that are no longer delayed and add them to the queue.
  let timer = peek(timerQueue);
  while (timer !== null) {
    if (timer.callback === null) {
      // Timer was cancelled.
      pop(timerQueue);
    } else if (timer.startTime <= currentTime) {
      // Timer fired. Transfer to the task queue.
      pop(timerQueue);
      timer.sortIndex = timer.expirationTime;
      push(taskQueue, timer);
      if (enableProfiling) {
        markTaskStart(timer, currentTime);
        timer.isQueued = true;
      }
    } else {
      // Remaining timers are pending.
      // 第一个任务的开始时间还没到，那后面的就不用看了都没到
      return;
    }
    timer = peek(timerQueue);
  }
}

/*
* requestHostTimeout内，经过指定延迟时间后，执行handleTimeout；
* 该函数内部，以currentTime为准，advanceTimers 将timerQueue内部过期的任务重新更新sortndex为过期时间然后移至taskQueue
// * 然后把任务交给requestHostCallback ，让他去调度过期任务，看他是否可以安排主线程回调执行
* 如果主线程没有正在执行的回到任务，那么就给安排下
* 1、如果taskQueue 有任务，那就执行flushWork
* 2、否则，就接着等最快过期时间去处理 timerQueue；
* */
function handleTimeout(currentTime: number) {
  isHostTimeoutScheduled = false;
  advanceTimers(currentTime);
  /* 如果没有处于调度中 */
  if (!isHostCallbackScheduled) {
    if (peek(taskQueue) !== null) {
      isHostCallbackScheduled = true;
      requestHostCallback(flushWork);
    } else {
      const firstTimer = peek(timerQueue);
      if (firstTimer !== null) {
        requestHostTimeout(handleTimeout, firstTimer.startTime - currentTime);
      }
    }
  }
}

function flushWork(hasTimeRemaining: boolean, initialTime: number) {
  if (enableProfiling) {
    markSchedulerUnsuspended(initialTime);
  }

  // We'll need a host callback the next time work is scheduled.
  // 1. 做好全局标记, 表示现在已经进入调度阶段
  isHostCallbackScheduled = false;
  if (isHostTimeoutScheduled) {/* 如果有延时任务，那么先暂定延时任务*/
    // We scheduled a timeout but it's no longer needed. Cancel it.
    isHostTimeoutScheduled = false;
    cancelHostTimeout();
  }

  isPerformingWork = true;
  const previousPriorityLevel = currentPriorityLevel;
  try {
    if (enableProfiling) {
      try {
        return workLoop(hasTimeRemaining, initialTime);
      } catch (error) {
        if (currentTask !== null) {
          const currentTime = getCurrentTime();
          // $FlowFixMe[incompatible-call] found when upgrading Flow
          markTaskErrored(currentTask, currentTime);
          // $FlowFixMe[incompatible-use] found when upgrading Flow
          currentTask.isQueued = false;
        }
        throw error;
      }
    } else {
      // No catch in prod code path.
      /*  2. 循环消费队列
      执行 workLoop 里面会真正调度我们的事件  */
      return workLoop(hasTimeRemaining, initialTime);
    }
  } finally {
    // 3. 还原全局标记
    currentTask = null;
    currentPriorityLevel = previousPriorityLevel;
    isPerformingWork = false;
    if (enableProfiling) {
      const currentTime = getCurrentTime();
      markSchedulerSuspended(currentTime);
    }
  }
}

/*
! 短小精悍的逻辑  此处实现了  时间切片(time slicing)和fiber树的可中断渲染
! 此workLoop非调和中的workLoop，返回值为当前帧过期任务是否执行完毕；核心是为true时实现中断和恢复。
zd workLoop的执行会返回一个boolean用于判断是全部执行完毕还是被中断了，
  true表示当前帧执行完了，但是过期任务的过期时间没有到，那么下一帧执行继续执行这个任务，
  为false表示过期任务队列全部执行完毕了。
 时间切片原理：
        消费任务队列的过程中, 可以消费1~n个 task, 甚至清空整个 queue. 但是在每一次具体执行task.callback之前都要进行超时检测, 如果超时可以立即退出循环并等待下一次调用
  可中断渲染原理
  在时间切片的基础之上, 如果单个task.callback执行时间就很长(假设 200ms). 就需要task.callback自己能够检测是否超时, 所以在 fiber 树构造过程中,
  每构造完成一个单元,都会检测一次超时(packages/react-reconciler/src/ReactFiberWorkLoop.js:2366), 如遇超时就退出fiber树构造循环,
  并返回一个新的回调函数(就是此处的continuationCallback)并等待下一次回调继续未完成的fiber树构造.
每一次while循环的退出就是一个时间切片， // 这里需要isHostCallbackScheduled和isPerformingWork两个开关的原因是，防止在
// 正在工作中的task中又调度了unstable_scheduleCallback添加任务
@initialTime 此次世界切片调度发起的时间
  */
function workLoop(hasTimeRemaining: boolean, initialTime: number) {
  let currentTime = initialTime;
  advanceTimers(currentTime);
  /* 获取任务列表中的第一个 */
  currentTask = peek(taskQueue);
  // 如果存在任务
  while (
    currentTask !== null &&
    !(enableSchedulerDebugging && isSchedulerPaused)
  ) {
    /*
    *  虽然currentTask没有过期, 但是当前宏任务执行时间超过了限制(毕竟只有5ms, shouldYieldToHost()返回true).
    * 停止继续执行, 让出主线程，剩下的任务再下一个事件循环中执行
    * */
    if (
      currentTask.expirationTime > currentTime &&
      (!hasTimeRemaining || shouldYieldToHost())
    ) {
      // This currentTask hasn't expired, and we've reached the deadline.
      break;
    }
    // $FlowFixMe[incompatible-use] found when upgrading Flow
    //* 真正的更新函数 callback .就是你传入的回调函数，比如packages/react-reconciler/src/ReactFiberWorkLoop.js:1039
    const callback = currentTask.callback;
    if (typeof callback === 'function') {
      // $FlowFixMe[incompatible-use] found when upgrading Flow
      currentTask.callback = null;
      // $FlowFixMe[incompatible-use] found when upgrading Flow
      currentPriorityLevel = currentTask.priorityLevel;
      // $FlowFixMe[incompatible-use] found when upgrading Flow
      const didUserCallbackTimeout = currentTask.expirationTime <= currentTime;
      if (enableProfiling) {
        // $FlowFixMe[incompatible-call] found when upgrading Flow
        markTaskRun(currentTask, currentTime);
      }
      const continuationCallback = callback(didUserCallbackTimeout);
      currentTime = getCurrentTime();
      if (typeof continuationCallback === 'function') {
        // If a continuation is returned, immediately yield to the main thread
        // regardless of how much time is left in the current time slice.
        // $FlowFixMe[incompatible-use] found when upgrading Flow
        // 如果你的回调函数执行完结果返回一个函数，那就把这个返回函数作为当前任务的回调
        // 产生了连续回调(如fiber树太大, 出现了中断渲染), 保留currentTask
        currentTask.callback = continuationCallback;
        if (enableProfiling) {
          // $FlowFixMe[incompatible-call] found when upgrading Flow
          markTaskYield(currentTask, currentTime);
        }
        // 将延期任务转移至过期任务队列啊
        advanceTimers(currentTime);
        return true;
      } else {
        if (enableProfiling) {
          // $FlowFixMe[incompatible-call] found when upgrading Flow
          markTaskCompleted(currentTask, currentTime);
          // $FlowFixMe[incompatible-use] found when upgrading Flow
          currentTask.isQueued = false;
        }
        // 此处为什么还需要判断下？因为在上面执行callback(didUserCallbackTimeout); 的时候，callback你不清楚到底执行了什么
        // 如果内部调用了scheduleCallback，插入了一个高优先级的任务，任务队列是小顶堆，该任务就会排在taskQueue的第一个，这就是插队。需要立即执行，就不能直接删除了。
        // 如果第一个任务和当前任务相等，说明并没有高优先级的任务插队
        if (currentTask === peek(taskQueue)) {
          pop(taskQueue);
        }
        // 看下是否有过期任务
        advanceTimers(currentTime);
      }
    } else {
      // 任务被取消了 看看performConcurrentWorkOnRoot 最后一句返回的是啥，callback =null ;
      pop(taskQueue);
    }
    // 再次取出过期任务去执行
    currentTask = peek(taskQueue);
  }
  // Return whether there's additional work
  // 此处是中断逻辑，任务还未执行完，但是没有时间了，就会被shouldYieldToHost 中断；
  // 但是此时currentTask任务并没有被清除掉，并且当前的任务的回调也是可以指定的。
  if (currentTask !== null) {
    return true;
  } else {
    // 如果taskQueue已经没有工作，同时timerQueue还有工作，则需要启用一个定时器延迟执行
    // 并返回false告诉当前帧内，taskQueue已经执行完毕
    const firstTimer = peek(timerQueue);
    if (firstTimer !== null) {
      requestHostTimeout(handleTimeout, firstTimer.startTime - currentTime);
    }
    return false;
  }
}

function unstable_runWithPriority<T>(
  priorityLevel: PriorityLevel,
  eventHandler: () => T,
): T {
  switch (priorityLevel) {
    case ImmediatePriority:
    case UserBlockingPriority:
    case NormalPriority:
    case LowPriority:
    case IdlePriority:
      break;
    default:
      priorityLevel = NormalPriority;
  }

  var previousPriorityLevel = currentPriorityLevel;
  currentPriorityLevel = priorityLevel;

  try {
    return eventHandler();
  } finally {
    currentPriorityLevel = previousPriorityLevel;
  }
}

function unstable_next<T>(eventHandler: () => T): T {
  var priorityLevel;
  switch (currentPriorityLevel) {
    case ImmediatePriority:
    case UserBlockingPriority:
    case NormalPriority:
      // Shift down to normal priority
      priorityLevel = NormalPriority;
      break;
    default:
      // Anything lower than normal priority should remain at the current level.
      priorityLevel = currentPriorityLevel;
      break;
  }

  var previousPriorityLevel = currentPriorityLevel;
  currentPriorityLevel = priorityLevel;

  try {
    return eventHandler();
  } finally {
    currentPriorityLevel = previousPriorityLevel;
  }
}

function unstable_wrapCallback<T: (...Array<mixed>) => mixed>(callback: T): T {
  var parentPriorityLevel = currentPriorityLevel;
  // $FlowFixMe[incompatible-return]
  // $FlowFixMe[missing-this-annot]
  return function () {
    // This is a fork of runWithPriority, inlined for performance.
    var previousPriorityLevel = currentPriorityLevel;
    currentPriorityLevel = parentPriorityLevel;

    try {
      return callback.apply(this, arguments);
    } finally {
      currentPriorityLevel = previousPriorityLevel;
    }
  };
}

function unstable_scheduleCallback(
  priorityLevel: PriorityLevel,
  callback: Callback,
  options?: {delay: number},
): Task {
  // ? 1、 获取当前时间
  var currentTime = getCurrentTime();

  var startTime;
  if (typeof options === 'object' && options !== null) {
    var delay = options.delay;
    if (typeof delay === 'number' && delay > 0) {
      startTime = currentTime + delay;
    } else {
      startTime = currentTime;
    }
  } else {
    startTime = currentTime;
  }

  //? 2、根据传入任务优先级，设置任务过期时间
  var timeout;
  switch (priorityLevel) {
    case ImmediatePriority:
      timeout = IMMEDIATE_PRIORITY_TIMEOUT;
      break;
    case UserBlockingPriority:
      timeout = USER_BLOCKING_PRIORITY_TIMEOUT;
      break;
    case IdlePriority:
      timeout = IDLE_PRIORITY_TIMEOUT;
      break;
    case LowPriority:
      timeout = LOW_PRIORITY_TIMEOUT;
      break;
    case NormalPriority:
    default:
      timeout = NORMAL_PRIORITY_TIMEOUT;
      break;
  }
  //计算过期时间：超时时间=开始时间（现在时间）+任务超时的时间（上面设置的那五个等级），时间越小，优先级越高。
  var expirationTime = startTime + timeout;
  //? 3、创建一个新任务
  var newTask: Task = {
    id: taskIdCounter++,
    callback,
    priorityLevel,
    startTime,
    expirationTime,
    sortIndex: -1,
  };
  if (enableProfiling) {
    newTask.isQueued = false;
  }

  if (startTime > currentTime) {
    // This is a delayed task.
    /* 通过开始时间排序 */
    newTask.sortIndex = startTime;
    // ? 4把任务放在timerQueue中
    push(timerQueue, newTask);
    // * 如果taskQueue 没有任务，并且新任务就是最早需要执行的延迟任务，那我们旧的取消前面创建的定时任务；
    // *因为在这个任务之前，可能timerQueue已经接受定时，准备执行了。现在我们就要插队。
    if (peek(taskQueue) === null && newTask === peek(timerQueue)) {
      // All tasks are delayed, and this is the task with the earliest delay.
      if (isHostTimeoutScheduled) {
        // Cancel an existing timeout.
        cancelHostTimeout();
      } else {
        isHostTimeoutScheduled = true;
      }
      /*  执行setTimeout ， */
      // Schedule a timeout.
      // ? 5 处理这无处安放的空闲时间，然后内部请求调度；其实就是delay时间后，我们去执行handleTimeout操作
      requestHostTimeout(handleTimeout, startTime - currentTime);
    }
  } else {
    /* 通过 expirationTime 排序  */
    newTask.sortIndex = expirationTime;
    // ? 4把任务放在把任务放入taskQueue中
    push(taskQueue, newTask);
    if (enableProfiling) {
      markTaskStart(newTask, currentTime);
      newTask.isQueued = true;
    }
    // Schedule a host callback, if needed. If we're already performing work,
    // wait until the next time we yield.
    /*没有处于调度中的任务， 然后向浏览器请求一帧，浏览器空闲执行 flushWork */
    // 此处是确保每次只有一个宏任务添加到时间系统中，如果已经存在了，就不要再去调度了；
    if (!isHostCallbackScheduled && !isPerformingWork) {
      isHostCallbackScheduled = true;
      // ? 5 请求调度
      // 将flushWork保存到scheduleHostCallback
      requestHostCallback(flushWork);
    }
  }

  return newTask;
}

function unstable_pauseExecution() {
  isSchedulerPaused = true;
}

function unstable_continueExecution() {
  isSchedulerPaused = false;
  if (!isHostCallbackScheduled && !isPerformingWork) {
    isHostCallbackScheduled = true;
    requestHostCallback(flushWork);
  }
}

function unstable_getFirstCallbackNode(): Task | null {
  return peek(taskQueue);
}

function unstable_cancelCallback(task: Task) {
  if (enableProfiling) {
    if (task.isQueued) {
      const currentTime = getCurrentTime();
      markTaskCanceled(task, currentTime);
      task.isQueued = false;
    }
  }

  // Null out the callback to indicate the task has been canceled. (Can't
  // remove from the queue because you can't remove arbitrary nodes from an
  // array based heap, only the first one.)
  task.callback = null;
}

function unstable_getCurrentPriorityLevel(): PriorityLevel {
  return currentPriorityLevel;
}

let isMessageLoopRunning = false;
let scheduledHostCallback:
  | null
  | ((
      hasTimeRemaining: boolean,
      initialTime: DOMHighResTimeStamp | number,
    ) => boolean) = null;
let taskTimeoutID: TimeoutID = (-1: any);

// Scheduler periodically yields in case there is other work on the main
// thread, like user events. By default, it yields multiple times per frame.
// It does not attempt to align with frame boundaries, since most tasks don't
// need to be frame aligned; for those that do, use requestAnimationFrame.
let frameInterval = frameYieldMs;
const continuousInputInterval = continuousYieldMs;
const maxInterval = maxYieldMs;
let startTime = -1;

let needsPaint = false;

/*
! 交还控制权给浏览器
* 1、现在时间减去调用workLoop遍历时的起始时间，如果<5ms 认为可以继续执行任务，不用交还
* 2、如果
* */
function shouldYieldToHost(): boolean {
  const timeElapsed = getCurrentTime() - startTime;
  if (timeElapsed < frameInterval) {
    // The main thread has only been blocked for a really short amount of time;
    // smaller than a single frame. Don't yield yet.
    return false;
  }
  // The main thread has been blocked for a non-negligible amount of time. We
  // may want to yield control of the main thread, so the browser can perform
  // high priority tasks. The main ones are painting and user input. If there's
  // a pending paint or a pending input, then we should yield. But if there's
  // neither, then we can yield less often while remaining responsive. We'll
  // eventually yield regardless, since there could be a pending paint that
  // wasn't accompanied by a call to `requestPaint`, or other main thread tasks
  // like network events.
  if (enableIsInputPending) {
    if (needsPaint) {
      // There's a pending paint (signaled by `requestPaint`). Yield now.
      return true;
    }
    if (timeElapsed < continuousInputInterval) {
      // We haven't blocked the thread for that long. Only yield if there's a
      // pending discrete input (e.g. click). It's OK if there's pending
      // continuous input (e.g. mouseover).
      if (isInputPending !== null) {
        return isInputPending();
      }
    } else if (timeElapsed < maxInterval) {
      // Yield if there's either a pending discrete or continuous input.
      if (isInputPending !== null) {
        return isInputPending(continuousOptions);
      }
    } else {
      // We've blocked the thread for a long time. Even if there's no pending
      // input, there may be some other scheduled work that we don't know about,
      // like a network event. Yield now.
      return true;
    }
  }

  // `isInputPending` isn't available. Yield now.
  return true;
}

function requestPaint() {
  if (
    enableIsInputPending &&
    navigator !== undefined &&
    // $FlowFixMe[prop-missing]
    navigator.scheduling !== undefined &&
    // $FlowFixMe[incompatible-type]
    navigator.scheduling.isInputPending !== undefined
  ) {
    needsPaint = true;
  }

  // Since we yield every frame regardless, `requestPaint` has no effect.
}

function forceFrameRate(fps: number) {
  if (fps < 0 || fps > 125) {
    // Using console['error'] to evade Babel and ESLint
    console['error'](
      'forceFrameRate takes a positive int between 0 and 125, ' +
        'forcing frame rates higher than 125 fps is not supported',
    );
    return;
  }
  if (fps > 0) {
    frameInterval = Math.floor(1000 / fps);
  } else {
    // reset the framerate
    frameInterval = frameYieldMs;
  }
}

// 在这一帧有剩余的时间内，就执行workLoop
const performWorkUntilDeadline = () => {
  if (scheduledHostCallback !== null) {
    const currentTime = getCurrentTime();
    // Keep track of the start time so we can measure how long the main thread
    // has been blocked.
    // 我们从主线程接手管理任务的开始时间
    startTime = currentTime;
    const hasTimeRemaining = true;

    // If a scheduler task throws, exit the current browser task so the
    // error can be observed.
    //
    // Intentionally not using a try-catch, since that makes some debugging
    // techniques harder. Instead, if `scheduledHostCallback` errors, then
    // `hasMoreWork` will remain true, and we'll continue the work loop.
    let hasMoreWork = true;
    try {
      // $FlowFixMe[not-a-function] found when upgrading Flow
      hasMoreWork = scheduledHostCallback(hasTimeRemaining, currentTime);
    } finally {
      //zd 如果workLoop返回值为true，让他下一帧时继续执行过期任务队列的第一个 也就是上一帧没执行完的任务
      if (hasMoreWork) {
        // If there's more work, schedule the next message event at the end
        // of the preceding one.
        schedulePerformWorkUntilDeadline();
      } else  {
        isMessageLoopRunning = false;
        scheduledHostCallback = null;
      }
    }
  } else {
    isMessageLoopRunning = false;
  }
  // Yielding to the browser will give it a chance to paint, so we can
  // reset this.
  needsPaint = false;
};

/*
* 异步选择策略：
* 因为我们要实现的是把调度权还给浏览器，所以我们的异步任务实现必须是一个宏任务，
* 因为只有宏任务会在下次事件循环中执行，不会阻塞当前页面的渲染；
* 1、首选 localSetImmediate ，但是这个只存在于node环境和IE历史版本
* 2、这里没选常见的setTimeout而是MessageChannel，是因为setTimeout即使时间间隔设置为0，但是真正执行其实是4-5ms左右
*       为了让视图能够看起来比较流畅，按照人们能感知到最低限度每秒 60 帧的频率划分时间片，这样每个时间片就是16ms,这16ms
*       要完成JS执行，浏览器渲染等操作，但是setTimeout本身就浪费了4-5ms,所以舍弃改方案，选用messageChannel，能在0-1ms内触发
* 3、如果浏览器不支持messageChannel，那还是得用setTimeout兜底
* */
let schedulePerformWorkUntilDeadline;
if (typeof localSetImmediate === 'function') {
  // Node.js and old IE.
  // There's a few reasons for why we prefer setImmediate.
  //
  // Unlike MessageChannel, it doesn't prevent a Node.js process from exiting.
  // (Even though this is a DOM fork of the Scheduler, you could get here
  // with a mix of Node.js 15+, which has a MessageChannel, and jsdom.)
  // https://github.com/facebook/react/issues/20756
  //
  // But also, it runs earlier which is the semantic we want.
  // If other browsers ever implement it, it's better to use it.
  // Although both of these would be inferior to native scheduling.
  schedulePerformWorkUntilDeadline = () => {
    localSetImmediate(performWorkUntilDeadline);
  };
} else if (typeof MessageChannel !== 'undefined') {
  // DOM and Worker environments.
  // We prefer MessageChannel because of the 4ms setTimeout clamping.
  const channel = new MessageChannel();
  const port = channel.port2;
  channel.port1.onmessage = performWorkUntilDeadline;
  schedulePerformWorkUntilDeadline = () => {
    port.postMessage(null);
  };
} else {
  // We should only fallback here in non-browser environments.
  schedulePerformWorkUntilDeadline = () => {
    // $FlowFixMe[not-a-function] nullable value
    localSetTimeout(performWorkUntilDeadline, 0);
  };
}

// 放入messageChannel中的回调函数是flushWork
// flushWork-->workLook 这个注册给scheduledHostCallback，如果没有正在进行的循环，那就开始执行吧
// flushWork函数作为参数被传入调度中心内核等待回调.
function requestHostCallback(
  callback: (hasTimeRemaining: boolean, initialTime: number) => boolean,
) {
  scheduledHostCallback = callback;
  if (!isMessageLoopRunning) {
    isMessageLoopRunning = true;
    // schedule 安排执行PerformWorkUntilDeadline 妈的这些鬼命名，虽然很标准，但是也他么的太相似了
    schedulePerformWorkUntilDeadline();
  }
}

function requestHostTimeout(
  callback: (currentTime: number) => void,
  ms: number,
) {
  // $FlowFixMe[not-a-function] nullable value
  taskTimeoutID = localSetTimeout(() => {
    callback(getCurrentTime());
  }, ms);
}

function cancelHostTimeout() {
  // $FlowFixMe[not-a-function] nullable value
  localClearTimeout(taskTimeoutID);
  taskTimeoutID = ((-1: any): TimeoutID);
}

export {
  ImmediatePriority as unstable_ImmediatePriority,
  UserBlockingPriority as unstable_UserBlockingPriority,
  NormalPriority as unstable_NormalPriority,
  IdlePriority as unstable_IdlePriority,
  LowPriority as unstable_LowPriority,
  unstable_runWithPriority,
  unstable_next,
  unstable_scheduleCallback,
  unstable_cancelCallback,
  unstable_wrapCallback,
  unstable_getCurrentPriorityLevel,
  shouldYieldToHost as unstable_shouldYield,
  requestPaint as unstable_requestPaint,
  unstable_continueExecution,
  unstable_pauseExecution,
  unstable_getFirstCallbackNode,
  getCurrentTime as unstable_now,
  forceFrameRate as unstable_forceFrameRate,
};

export const unstable_Profiling: {
  startLoggingProfilingEvents(): void,
  stopLoggingProfilingEvents(): ArrayBuffer | null,
} | null = enableProfiling
  ? {
      startLoggingProfilingEvents,
      stopLoggingProfilingEvents,
    }
  : null;
