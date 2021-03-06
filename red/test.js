let { TESTS } = require('./shared')

module.exports = function (RED) {
  function Node(config) {
    RED.nodes.createNode(this, config)

    const node = this
    const global = this.context().global

    node.on('input', function (msg) {
      // Get reference to thing
      let name = config.name || msg.topic
      let thing = global.get('things')[name]

      // Check for thing
      if (!thing) {
        node.error(`Thing '${name}' not found`)
        node.status({
          fill: 'red',
          shape: 'ring',
          text: 'Thing not found'
        })
        return
      }

      // Set status (only if configured for specific thing)
      if (config.name) node.status(thing.status)

      // Check all rules
      let pass = config.rules.every(rule => {
        try {
          let test = TESTS[rule.compare]

          let a = RED.util.getObjectProperty(thing, rule.thingProp)

          if (/true|false|null|nnull|empty|nempty/.test(rule.compare)) return test(a)

          if (/istype/.test(rule.compare)) return test(a, rule.value)

          let b = RED.util.evaluateNodeProperty(rule.value, rule.valType, node, msg)

          if (/btwn/.test(rule.compare)) {
            let c = RED.util.evaluateNodeProperty(rule.value2, rule.valType2, node, msg)
            return test(a, b, c)
          }

          if (/regex/.test(rule.compare)) return test(a, b, rule.case)

          return test(a, b)
        } catch (err) {
          node.warn(`Error during test: ${err}`)
          return false
        }
      })

      // Output, maybe
      if (pass) node.send(msg)
      else if (config.secondOutput) node.send([null, msg])
    })
  }
  RED.nodes.registerType('Thing Test', Node)
}
