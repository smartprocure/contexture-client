import _ from 'lodash/fp'
import F from 'futil-js'
import { Tree, encode } from './util/tree'
import { runTypeFunction, runTypeFunctionOrDefault, getTypeProp } from './types'

export let defaults = {
  path: null,
  updating: null,
  lastUpdateTime: null,
  markedForUpdate: null,
  hasValue: null,
  error: null,
  context: null,
  missedUpdate: null,
  paused: null,
  type: null,
  updatingPromise: null,
  updatingDeferred: null,
  metaHistory: [],
}
export let internalStateKeys = {
  ..._.omit(['type', 'paused'], defaults),
  validate: null,
  onMarkForUpdate: null,
  afterSearch: null,
}

export let autoKey = x => F.compactJoin('-', [x.field, x.type]) || 'node'

export let initNode = _.curry((extend, types, dedupe, parentPath, node) => {
  runTypeFunction(types, 'init', node, extend)
  let key = dedupe(
    node.key ||
      runTypeFunctionOrDefault(autoKey, types, 'autoKey', node, extend)
  )
  extend(node, {
    ..._.omit(_.keys(node), defaults),
    ..._.omit(_.keys(node), getTypeProp(types, 'defaults', node)),
    key,
    path: [...parentPath, key],
    // if node.children
    get markedForUpdate() {
      return _.some('markedForUpdate', node.children)
    },
    // if node.children
    get updating() {
      return _.some('updating', node.children)
    },
    // both cases
    get isStale() {
      return node.markedForUpdate || node.updating
    },
  })
})

// fn: (dedupe: string -> string, parentPath: array, node: object) -> void
export let dedupeWalk = (fn, tree, { target = {}, dedupe } = {}) => {
  // allows us to maintain separate deduplication caches for each node's children by
  // storing a `uniqueString` instance in `dedupes` with that node's path as its key.
  // this ensures that autogenerated node keys will always be unique from their siblings,
  // but won't be unnecessarily modified if they are duplicates of keys in other branches.
  let dedupes = target.path ? { [encode(target.path)]: dedupe } : {}
  Tree.walk((node, index, [parent = {}]) => {
    let parentPath = parent.path || target.path || []
    fn(dedupes[encode(parentPath)] || _.identity, parentPath, node)
    dedupes[encode(node.path)] = F.uniqueString([])
  })(tree)
}

export let hasContext = node => node && node.context
let throwsError = x => {
  throw Error(x)
} // Throw expressions are stage 3 :(
export let hasValue = node =>
  node && _.isUndefined(node.hasValue)
    ? throwsError('Node was never validated')
    : node && node.hasValue && !node.error
