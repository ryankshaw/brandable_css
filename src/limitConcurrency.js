import {debug} from './utils'

export default function limitConcurrency (maxConcurrency, fn) {
  const queue = []
  let running = 0
  function startTask ({args, resolve, reject}) {
    running++
    debug('task started. args:', args, `running: ${running} queued: ${queue.length}`)
    return fn.apply(this, args).then(onFinish).then(resolve, reject)
  }
  function enqueTask ({args}) {
    debug('task enqued. args:', args, `running: ${running} queued: ${queue.length}`)
    return new Promise(function (resolve, reject) {
      queue.push({args, resolve, reject})
    })
  }
  function onFinish (_) {
    running--
    debug(`task finished. running: ${running} queued: ${queue.length}`)
    const task = queue.shift()
    if (task) startTask(task)
    return _
  }
  return function () {
    return (running < maxConcurrency ? startTask : enqueTask)({args: arguments})
  }
}
