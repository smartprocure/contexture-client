﻿# contexture-client
The Contexture (aka ContextTree) Client

[![npm version](https://badge.fury.io/js/contexture-client.svg)](https://badge.fury.io/js/contexture-client)
[![CircleCI](https://circleci.com/gh/smartprocure/contexture-client.svg?style=svg)](https://circleci.com/gh/smartprocure/contexture-client)

## Overview
This library manages the state of a contexture tree to automatically run only the optimal minimal amount of searches possible.

In general, you perform `actions` which `dispatch` one or more events to an instantiated client, and it reacts by intelligently running searches as needed.

### Helpful Mental Models
To help people grok the purpose of the this library, this section attempts to explain in terms of mental models that developers are likely to have seen before.

#### Redux
You can think of the client like redux with prebuilt actions and reducers that are async and run searches.
Of course, astute readers will realize that model breaks down because a reducer that performs side effects and doesn't return new state isn't a reducer at all.

#### Pub/Sub
You can think of the client as a pub/sub system with prebuilt subscribers that can handle specific events. `dispatch` is like publish with the internal process/reactor functions acting as subscribers.


## Feature Highlights

- Updates individual nodes independently
- Updates only the most minimal set of nodes possible in response to changes
  - Powered by reactors (only/others/all, field/join change, item add/remove) which account for and/or/not relationship
- Per node Pause/Resume
  - Keeps track of if it missed updates, allowing it to know if it needs to update on resume or not
- Per node async validation
  - Node types can implement a function to have a node instance pass (return true), be ignored for the search (return false), or block the search (throw)
- Eliminating blank nodes (nodes without values)
- Per Node Loading Indicators
- Intelligent Search Debouncing (global debounce and optional per node pausing until results come back)
- Dropping intermediate (stale) responses
- Error handling


## API

### Instantiation

The root function takes two parameters, `config` and actual `tree` instance. It's curried, so you can call it like this:

```js
ContextTree({...config}, tree)
```
or

```js
ContextTree({...config})(tree)
```

if you want to pre apply it with config.

#### Config
The following config options are available:

| Name       | Type                           | Default      | Description |
| ----       | ----                           | -------      | ----------- |
| service    | function                       | n/a          | **Required** Async function to actually get service results (from the contexture core). An exception will be thrown if this is not passed in. |
| types      | ClientTypeSpec                 | exampleTypes | Configuration of available types (documented below) |
| debounce   | number                         | 1            | How many milliseconds to globally debounce search |
| onChange   | (node, changes) => {}          |  _.noop      | A hook to capture when the client changes any property on a node |
| onResult   | (path, response, target) => {} |  _.noop      | A hook to capture when the client updates a node with results from the server |
| debug      | boolean                        | false        | Debug mode will log all dispatched events and generally help debugging |
| extend     | function                       | F.extendOn   | Used to mutate nodes internally |
| snapshot   | function                       | _.cloneDeep  | Used to take snapshots |

#### Client Types
Available types are passed in as config.

This is the general structure:

```js
{
  TypeName: {
    init: (node, extend) => {
      // Do stuff like extend the node with some default properties
    },
    validate: async node => true || false || throw Exception()
    reactors: {
      fieldName: 'reactor',
      field2...
    }
  },
  Type2....
}
```

When picking field reactors, you should use the `others` reactor for things that are used for filtering (formerly `data` properties), and `self` for things that are only used to determine that node's context result (formerly `config` properties).

**NOTE** There are a few reserved words you can't use for type properties:
- markedForUpdate
- path
- updating
- paused
- missedUpdate
- hasValue
- lastUpdateTime
- context

### Run Time
The following methods are exposed on an instantiated client

| Name | Signature | Description |
| ---- | --------- | ----------- |
| add | `async (path, newNode) -> await searchCompleted` | Adds a node to the tree as a child of the specified path. You can await this for when updates settle and relevant searches are completed. |
| remove | `async path -> await searchCompleted` | Removes a node at the specified path. You can await this for when updates settle and relevant searches are completed. |
| mutate | `async (path, deltas) -> await searchCompleted` | Mutates the node at the given path with the new values. You can await this for when updates settle and relevant searches are completed. |
| dispatch | `async event -> await searchCompleted` | A lower level, core method of interaction (called automatically by the actions above). You can await this for when updates settle and relevant searches are completed. |
| getNode | `[path] -> node` | Lookup a node by a path (array of keys). |
| serialize | `() => tree` | Returns a snapshot of the tree without any of the temporary state like updating flags. |
| lens | `(path, prop) -> ({ get, set })` | Given a path and a property, returns a lens that provides a getter and a setter for the provided property on the provided path. |
| tree | tree | A reference to the internal tree. If you mutate this, you should dispatch an appropriate event. |

## Improvements

For those familiar with the previous client implementation (`DataContext`/`ContextGroup`), this client has a lot of design improvements:

- The update logic now accounts for the join relationship, making it even more precise about when to run searches
- Dispatch (and action methods) return a promise for when it resolves despite debounce, instead of relying on subscribing to when an `updating` observable becomes falsey.
- Much more memory efficient - functional instead of local function copies
- Instant traversals due to flat tree in parallel with nested
- Redux-y API

## Implementation Details
:construction: _More Details Coming Soon._ :construction:

### Process Algorithm

- An action method is called at the top level which:
  - Interally mutates the tree
  - Makes one or more calls to `dispatch` with relevant event data
- For each dispatched event:
  - Validate the entire tree (an async operation)
  - Bubble up the tree from the affected node up to the root, and for each node in the path:
    - Determine affected nodes by calling the reactor for the current event type
    - Mark each affected node for update, or if it is currently paused, mark that it missed updates
  - Trigger an update (which is debounced so it does not run right away)
- When the debounce elapses, an update is triggered:
  - Check if the update should be blocked
    - There may be no affected nodes
    - Some nodes might have erros on validation
  - Prepare for update - on each node that's markedForUpdate:
    - Set the lastUpdateTime to now (to enable dropping stale results later in this process)
    - Set `updating` to true
  - Serialize the search, omitting all temporary state except lastUpdateTime (which the sever will effectively echo back) and deleting nodes that are filter only with no value
  - Execute an actual contexture search
  - For each node in the response:
    - If the path isn't found in the current tree, ignore it
    - If the response is empty, ignore it
    - If the response has a lastUpdateTime earlier than the node in the current tree, ignore it (because it's stale)
    - If not ignoring the update, mutate the node with the result and set `updating` to false
- After all of this, the promise for the action/dispatch resolves (so you can await the entire process)

### Flat Trees

The client maintains a flat tree in addition to the actual tree, which is an object mapped using `flattenTree` from `futil-js`.
The keys are the array paths encoded as a string, currently using a slashEncoder.
This allows path lookups to perform in constant time at `O(1)`, drastically speeds up some of the internal tree operations.
The paths are also stamped on individual nodes for convenience as performing an action on a node requires knowing its path.

### Initialization
On instantiation, the client creates a flat tree representation of the tree and stamps the paths on the nodes.
