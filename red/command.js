let { commandBus, now } = require('./shared')

module.exports = function (RED) {

  function Node(config) {
    RED.nodes.createNode(this, config)

    let node = this
    let global = this.context().global

    function debug(msg) {
      if (config.debug) node.warn(msg)
    }
    function err(msg) {
      node.error(`Input message: ${JSON.stringify(msg)}`)
      return null
    }

    function getThing(name) {
      let thing = global.get('things')[name]
      if (!thing) return err(`Unknown thing ${name}`)
      return thing
    }

    node.on('input', function (msg) {
      debug(`Input message: ${JSON.stringify(msg)}`)

      let name = config.name || msg.topic
      let command = config.command || msg.payload

      if (!name) return err(`Thing name not specified in properties or input`)
      if (typeof command == 'undefined' || command === '') return err(`Command not specified in properties or input`)

      processCommand(name, command)

      node.status({
        text: `${name} | ${JSON.stringify(command)} | ${now()}`
      })
    })

    function processCommand(name, origCommand) {
      // Pointer to the thing
      let thing = getThing(name)
      if (!thing) return

      // Check if group
      if (thing.type == 'Group') {
        debug('Thing is a Group, sending to each:', thing.things)
        thing.things.forEach(subName => processCommand(subName, origCommand))
        return
      }

      // Check for proxies
      let passCommand = origCommand
      let proxy = Object.entries(thing.proxy || {})
      if (proxy.length) {
        debug(`Checking proxy for ${name}; Type of original command: ${typeof origCommand}`)
        if (Array.isArray(origCommand)) {
          // Unable to deal with array commands at this time
          node.warn(`Unable to handle proxies for array type commands`)
        } else if (typeof origCommand !== 'object') {
          // Simple command type (i.e. string, number, boolean)
          origCommand = origCommand.toString()  // All proxy commands will be keys of an object, hence must be a string
          let proxied = false
          proxy.forEach(([proxyThingName, { command }]) => command && Object.entries(command).forEach(([thisCommand, thatCommand]) => {
            if (origCommand == thisCommand) {
              debug(`Using command proxy from ${name} to ${proxyThingName} for '${thisCommand}'=>'${thatCommand}'`)
              emitCommand({ thing: getThing(proxyThingName), command: thatCommand, origThing: thing, origCommand })
              proxied = true
            }
          }))
          if (proxied) return
          debug(`No proxy found for command ${thisCommand}`)
        } else {
          // Complex command type (i.e. object)
          passCommand = { ...origCommand }  // Shallow copy, so that keys can be deleted if used by proxy
          let proxiedKeys = []
          proxy.forEach(([proxyThingName, { command }]) => {
            if (command) {
              let proxyMap = Object.entries(command).filter(([thisCommand]) => origCommand.hasOwnProperty(thisCommand))

              if (proxyMap.length) {
                let proxyCommand = {}
                proxyMap.forEach(([thisCommand, thatCommand]) => {
                  proxyCommand[thatCommand] = origCommand[thisCommand]
                  proxiedKeys.push(thisCommand)
                })
                debug(`Using command proxy from ${name} to ${proxyThingName} for ${JSON.stringify(proxyCommand)}`)
                emitCommand({ thing: getThing(proxyThingName), command: proxyCommand, origThing: thing, origCommand })
              }
            }
          })
          if (proxiedKeys.length) proxiedKeys.forEach(key => delete passCommand[key])
          if (Object.keys(passCommand).length == 0) return debug('All commands proxied')
        }
      }

      emitCommand({ thing, command: passCommand, origCommand })

    }

    function emitCommand(msg) {
      if (!msg.thing) return
      debug(`Sending command to type ${msg.thing.type}: ${JSON.stringify(msg)}`)
      // Emit to the bus so that all other nodes that
      // are configured for this thing type will output.
      commandBus.emit(msg.thing.type, msg)
    }
  }
  RED.nodes.registerType('Thing Command', Node)
}