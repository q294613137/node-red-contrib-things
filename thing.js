let EventEmitter = require('events')
let deepmerge = require('deepmerge')

module.exports = function (RED) {
  // The bus is used to trigger all nodes with a given thing name
  // to output when any node of the same name receives an input.
  let bus = new EventEmitter()

  // Temporary storage for parent assignments. This is used if
  // the a parent is being setup with a proxy, but the child
  // has not been set up yet. When child is setup, it will
  // read from here.
  let parentAssignment = {}

  function ThingNode(config) {
    RED.nodes.createNode(this, config)

    let node = this

    // Initialize global.things if it doesn't exist, then create pointer
    let global = this.context().global
    if (!global.get('things')) global.set('things', {})
    const THINGS = global.get('things')

    node.on('input', function (msg) {
      // Name should be set in properties, or provided on input.
      // Property takes precedence.
      let name = config.name || msg.topic

      // If setup is used, add thing to global.things
      if (msg.setup) {
        let newThing = msg.setup

        if (!name) {
          node.error(`Name must be specified if setup is used`)
          return
        }
        if (typeof newThing !== 'object') {
          node.error(
            `Payload for ${name} must be an object; Instead got: ${JSON.stringify(newThing)}`
          )
          return
        }

        // Sets defaults first, then includes the payload from input
        THINGS[name] = {
          id: name,
          name,
          type: '',
          props: {},
          state: {},
          status: state => ({ text: JSON.stringify(state) }),
          parents: parentAssignment[name],
          ...newThing
        }
        let thing = THINGS[name]

        // If proxies are specified
        if (thing.proxy) {
          //
          // For each proxied thing
          Object.entries(thing.proxy).forEach(([proxyThingName, { state: stateMap }]) => {
            //
            // Link states with getter
            Object.entries(stateMap).forEach(([from, to]) =>
              Object.defineProperty(thing.state, from, {
                // This check for the thing is mostly just in case it attempts to
                // use this state to update the status before the child has been setup
                get: () => THINGS[proxyThingName] && THINGS[proxyThingName].state[to],
                enumerable: true
              })
            )

            // Find proxied thing (i.e. the child)
            let proxyThing = THINGS[proxyThingName]
            if (proxyThing) {
              // If already setup, note parent in proxied thing
              proxyThing.parents = addUnique(proxyThing.parents, name)
            } else {
              // Otherwise, store in backlog until proxied thing has been setup
              parentAssignment[proxyThingName] = addUnique(parentAssignment[proxyThingName], name)
            }
          })
        }
      } else if (name) {
        // Must be state update message
        let stateUpdate = msg.payload

        // Pointer to the thing
        let thing = THINGS[name]

        if (!thing) {
          node.error(`Unknown thing ${name}`)
          return
        }

        // Update state accordingly
        if (msg.replace) {
          thing.state = stateUpdate
        } else {
          thing.state = deepmerge(thing.state, stateUpdate)
        }
      } else {
        // No name specified
        node.error('Thing name is required in properties or input')
        return
      }

      // Emit to the bus so that all other nodes that
      // are configured to output on changes/updates
      // will be triggered. (And update their status)
      bus.emit(name)

      // If configured to output on input (or this is for
      // setup), send message here because it wasn't done
      // by the bus (for simplicity)
      if (config.output == 'input' || msg.setup)
        return {
          topic: name,
          payload: THINGS[name].state,
          thing: config.incThing && THINGS[name]
        }
    })

    // During node creation, if name is set in properties,
    // need to setup a listener on the bus to trigger
    // off of any other node that updates this thing's
    // state. This will change the node's status and
    // output a message (if configured as such)
    if (config.name != '') {
      // Keep last known state (only used when config.output == 'change')
      let lastKnownState = ''

      // The function to be called when triggered
      let action = () => {
        let thing = THINGS[config.name]
        if (!thing) return

        updateStatus()

        // Serialize latest state
        let latestState = JSON.stringify(thing.state)

        // Output state message accordingly
        if (config.output == 'all' || (config.output == 'change' && lastKnownState != latestState))
          node.send({
            topic: thing.name,
            payload: thing.state,
            thing: config.incThing && thing
          })

        // Update last known state
        lastKnownState = latestState

        // Check for parents and trigger
        thing.parents && thing.parents.forEach(parent => bus.emit(parent))
      }

      // Listen for state updates for this thing
      bus.on(config.name, action)

      // When node destroyed, stop listening
      node.on('close', function () {
        bus.off(config.name, action)
      })
    }

    // Updates the node status
    function updateStatus() {
      if (!config.name) return
      let thing = THINGS[config.name]
      if (thing) {
        try {
          node.status(thing.status(thing.state, thing.props))
        } catch (err) {
          node.warn(`Unable to set status for ${thing.name}: ${err}`)
        }
      }
    }

    // Initialize status (if thing already exists)
    updateStatus()
  }
  RED.nodes.registerType('thing', ThingNode)
}

function addUnique(array, item) {
  return [...(array || []), item].filter((el, i, all) => all.indexOf(el) == i)
}
