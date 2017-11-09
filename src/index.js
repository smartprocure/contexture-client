import _ from 'lodash/fp'
import * as F from 'futil-js'
import {flattenTree, bubbleUpAsync, flatLeaves, decodePath, encodePath, Tree} from './util/tree'
import {catches} from './util/futil'
import {mapValuesAsync, flowAsync} from './util/promise'

import {validate} from './validation'
import {getAffectedNodes} from './reactors'
import actions from './actions'
import serialize from './serialize'
// Named Traversals
import {
  markForUpdate,
  markLastUpdate,
  prepForUpdate,
  acknoweldgeMissedUpdates
} from './traversals'
import {defaultTypes, runTypeFunction, getTypeProp} from './types'

let process = flowAsync(4)(
  getAffectedNodes,
  _.each(n => {
    acknoweldgeMissedUpdates(n)
    if (!_.some('markedForUpdate', n.children)) markForUpdate(n)
  })
)

export let ContextTree = (
  tree,
  service = () => {
    throw new Error('No update service provided!')
  },
  types = defaultTypes,
  {
    subscribers = [],
    snapshot = _.cloneDeep,
    debounce = 1,
    allowBlank = false,
    debug //= true
  } = {}
) => {
  let log = x => debug && console.log(x)
  let flat = flattenTree(tree)
  let getNode = path => flat[encodePath(path)]
  let fakeRoot = { key: 'virtualFakeRoot', path: '', children: [tree] }
  let typeFunction = runTypeFunction(types)
  let typeProp = getTypeProp(types)
  let { validateLeaves, validateGroup } = validate(typeFunction('validate'))

  // Event Handling
  let dispatch = async event => {
    let { type, path, dontProcess } = event
    log(`${type} event at ${path} (${dontProcess ? 'internal' : 'user'} event)`)
    _.cond(subscribers)(event)
    if (dontProcess) return // short circuit deepClone and triggerUpdate
    // Avoid race conditions - what matters is state _at the time of dispatch_
    // snapshot might not be needed since await is blocking?
    let hasValueMap = await mapValuesAsync(validateGroup, snapshot(flat))

    // Process from instigator parent up to fake root so affectedNodes are always calculated in context of a group
    await bubbleUpAsync(process(event, hasValueMap, validateGroup), _.dropRight(1, path), flat)
    await process(event, hasValueMap, validateGroup, fakeRoot, fakeRoot.path)

    // trickleDown((node, p) => console.log('down', p, path, node), path, tree)
    return triggerUpdate()
  }
  let triggerUpdate = F.debounceAsync(debounce, async () => {
    if (await shouldBlockUpdate()) return log('Blocked Search')
    let now = new Date().getTime()
    markLastUpdate(now)(tree)
    let dto = serialize(snapshot(tree), {search: true})
    prepForUpdate(tree)
    processResponse(await service(dto, now))
  })
  let shouldBlockUpdate = catches(() => true)(async () => {
    let leaves = flatLeaves(flat)
    let allBlank = _.every(x => !x, await validateLeaves(leaves))
    let noUpdates = !_.some('markedForUpdate', leaves)
    return noUpdates || (!(tree.allowBlank || allowBlank) && allBlank)
  })
  let processResponse = ({data, error}) => {
    _.each(node => {
      let target = flat[node.path]
      if (!target) return
      let responseNode = _.pick(['context', 'error'], node)
      F.mergeOn(target, responseNode)
      target.updating = false
      if (!node.children)
        dispatch({
          type: 'update',
          path: decodePath(node.path),
          value: responseNode,
          node,
          dontProcess: true
        })
    }, flattenTree(data))
    if (error) tree.error = error
  }

  let {add, remove, mutate} = actions({ getNode, flat, dispatch })
  let subscribe = (f, cond = _.stubTrue) => {
    let index = subscribers.length
    // Potential improvement - optimize for `path` cases and store locally at node (assuming we have lots of subscriptions to different nodes)
    subscribers.push([_.iteratee(cond), f])
    return () => subscribers.splice(index, 1)
  }

  return {
    tree,
    getNode,

    // Actions
    add,
    remove,
    mutate,

    dispatch,
    subscribe,
    serialize: () => serialize(snapshot(tree), {})
  }
}
export default ContextTree

// TODO
//   rearg contexture so types + service can be curried first and reused in app - add two options obj and merge (so we can have defaults)

//TODO
//  unify notify subscribers with dispatch/mutate
// subscribe(path, fn, type), fn: (delta, node) -> null
// OR! just `dispatch` the change type as 'update', then allow external subscriptions to dispatch


// TODO
// types (validate, to(Human)String, defaults?, hasContext)
// schemas?
// subscriptions (e.g. cascade)
// make sure all locally tracked props are in _meta or something like that
//    Constrain all update to an update meta method which can be overriden to support observables and notifications
//  both kinds of pausing - normal and queue paused
// sergvice adapter + children vs items
// subquery/savedsearch
// tree lenses
// broadcast pausing, just hold on to dispatches?
// Add
//   never updated
