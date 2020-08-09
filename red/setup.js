let { systemBus, stateBus, pushUnique } = require('./shared')

module.exports = function (RED) {

  function Node(config) {

    RED.nodes.createNode(this, config)

    let node = this

    node.status({
      shape: 'dot',
      fill: 'blue',
      text: 'Initializing...'
    })

    // Initialize global.things if it doesn't exist
    const global = this.context().global
    if (!global.get('things')) global.set('things', {})
    const THINGS = global.get('things')

    let errors = 0

    config.things.forEach((newThing, i) => {

      if (!newThing.name) {
        node.error(`Thing name missing during setup (${config.thingType}:${i})`)
        return errors++
      }

      if (config.thingType == 'Group') {

        let { name, things } = newThing

        THINGS[name] = {
          name,
          things
        }

      } else { // config.thingType != 'Group'

        let { name, id } = newThing

        if (id.trim() === '') id = name
        else if (!isNaN(id)) id = +id

        let oldThing = THINGS[name]

        // Check for known parents
        let parents = []
        Object.values(THINGS)
          .filter(t => t.proxy)
          .forEach(possibleParent => {
            let proxyDef = possibleParent.proxy[name]
            if (proxyDef && proxyDef.state) parents.push(possibleParent.name)
          })

        if (config.debug)
          node.warn(`Setting up ${name} with parents ${parents.length ? parents : '<none>'}`)

        // Sets defaults first, then includes the payload from input
        THINGS[name] = {
          id,
          name,
          type: config.thingType,
          props: newThing.props || {},
          state: (oldThing && oldThing.state) || newThing.state || {},
          status: config.statusFunction
            ? new Function('state', 'props', config.statusFunction)
            : state => ({ text: JSON.stringify(state) }),
          parents: parents.length ? parents : undefined
        }
        let thing = THINGS[name]

        // If proxies are specified
        if (newThing.proxy) {
          //
          // For each proxied thing
          Object.entries(newThing.proxy).forEach(([proxyThingName, { state: stateMap }]) => {
            if (!stateMap) return
            //
            // Link states with getter
            Object.entries(stateMap).forEach(([from, to]) =>
              Object.defineProperty(thing.state, from, {
                get: () => {
                  // This check for the thing is mostly just in case it attempts to
                  // use this state to update the status before the child has been setup
                  const THINGS = global.get('things')
                  if (config.debug)
                    node.warn(
                      `Calling getter for '${name}'.state.${from} -- Will return '${
                      THINGS[proxyThingName] && THINGS[proxyThingName].state[to]
                      }'`
                    )
                  return THINGS[proxyThingName] && THINGS[proxyThingName].state[to]
                },
                enumerable: true
              })
            )

            // Find proxied thing (i.e. the child)
            let proxyThing = THINGS[proxyThingName]
            if (proxyThing) {
              if (config.debug) node.warn(`Adding parent ${name} to proxy child ${proxyThing.name}`)
              // If already setup, note parent in proxied thing
              pushUnique(proxyThing.parents, name)
            }
          })

        } // End if proxies are specified

      } // End if config.thingType != 'Group'

      // Emit to the bus so that all other nodes that
      // are configured to output on changes/updates
      // will be triggered. (And update their status)
      stateBus.emit(newThing.name)

    })

    node.status({
      shape: 'dot',
      fill: errors ? 'red' : 'green',
      text: errors ? 'Errors during setup, see debug log' : 'Complete'
    })


    // This setup node complete
    this.context().set('complete', true)

    // Check if all other setup nodes are complete
    let allReady = true
    let thisTypeReady = true
    RED.nodes.eachNode(otherConfig => {
      if (otherConfig.type != 'Thing Setup' || otherConfig.id == this.id) return

      let otherNode = RED.nodes.getNode(otherConfig.id)
      if (!otherNode || !otherNode.context().get('complete')) {
        allReady = false
        if (otherConfig.thingType == config.thingType) thisTypeReady = false
      }
    })

    // If all complete, emit ready (should only happen once per deployment)
    if (allReady) {
      // Sort things first (only for ease of access in UI)
      const THINGS = global.get('things')
      const ABC_THINGS = {}
      Object.keys(THINGS).sort().forEach(key => ABC_THINGS[key] = THINGS[key])
      global.set('things', ABC_THINGS)
      // Then emit ready
      systemBus.emit('ready', 'all')
    }
    if (thisTypeReady) {
      systemBus.emit(`ready`, config.thingType)
    }

    node.on('close', () => {
      systemBus.emit('not-ready')
      this.context().set('complete', false)
    })
  }
  RED.nodes.registerType('Thing Setup', Node)
}