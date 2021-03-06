#!/usr/bin/env node

const scream = (e) => {
  console.error(e.stack || e)

  if (e.message === `missing faugra's secret`) {
    process.exit(1)
  }
}

process.on('unhandledRejection', scream)
process.on('uncaughtException', scream)

const ora = require('ora')
const path = require('path')
const execa = require('execa')
const debug = require('debug')('faugra:watcher')
const chokidar = require('chokidar')
const { default: PQueue } = require('p-queue')
const defineFunctions = require('./define-functions')
// const generateTypes = require('./generate-types')
const defineIndexes = require('./define-indexes')
const defineRoles = require('./define-roles')
const pushSchema = require('./push-schema')
const buildSdk = require('./build-sdk')
const { ignored } = require('../utils')

const PATTERNS = {
  ts: '**/*.(ts|tsx)',
  udf: '**/*.udf',
  schema: '**/[A-Z]*.(gql|graphql)',
  index: '**/*.index',
  udr: '**/*.role',
  documents: '**/[a-z]*.(gql|graphql)',
}

const [directory = '.'] = process.argv.slice(2)
const queue = new PQueue({ autoStart: false, concurrency: 1 })
const lock = {}

const block = (type, file) => {
  lock[type] = lock[type] || []
  lock[type].push(file)
}

const unblock = (type) => {
  lock[type] = false
}

const runCallback = () => {
  if (!process.env.CALLBACK) return

  console.log(`Running callback '${process.env.CALLBACK}':`)
  const cmd = process.env.CALLBACK.split(' ')

  execa.sync(cmd.shift(), cmd, {
    stdio: ['pipe', process.stdout, process.stderr],
    cwd: process.cwd(),
  })

  console.log('')
}

const processor = (type, operation, file, cumulative) => {
  if (lock[type]) {
    return block(type, file)
  }

  if (cumulative) {
    block(type, file)
  }

  queue.add(async () => {
    const name = lock[type] || file
    unblock(type)

    if (!operation) {
      return debug(`Ignoring file(s) ${file} [${type}] (no operation defined)`)
    }

    const spinner = ora(`Processing ${name} [${type}]\n`).start()

    try {
      await operation(file)
      spinner.succeed(`Processed ${name} [${type}]`)
    } catch (e) {
      spinner.fail()
      console.error(e)
    }
  })
}

const watch = (type, pattern, operation, cumulative) =>
  new Promise((resolve) => {
    chokidar
      .watch(pattern, {
        ignoreInitial: Boolean(process.env.FAUGRA_WATCH_CHANGES),
        ignored: [/(^|[\/\\])\../, ...ignored],
        persistent: true,
        cwd: path.resolve(directory),
      })
      .on('error', (error) => debug(`error: ${error}`))
      .on('add', (file) => {
        file = path.join(directory, file)

        debug(`Watching ${file} [${type}]`)
        operation && processor(type, operation, file, cumulative)
      })
      .on('change', (file) => {
        file = path.join(directory, file)

        debug(`${file} has been changed [${type}]`)
        processor(type, operation, file, cumulative)
      })
      .on('ready', resolve)
  })

const main = async () => {
  const ts = await watch('Typescript', PATTERNS['ts'], null, true)

  // const schema = await watch('Schema', PATTERNS['schema'], (file) =>
  //   generateTypes(file, file.replace(/(.gql|.graphql)$/, '$1.d.ts'))
  // )

  const schema = await watch(
    'Schema',
    PATTERNS['schema'],
    () => pushSchema(PATTERNS['schema']),
    true
  )

  const index = await watch('Index', PATTERNS['index'], defineIndexes)

  const udr = await watch('UDR', PATTERNS['udr'], defineRoles)

  const udf = await watch('UDF', PATTERNS['udf'], defineFunctions)

  const documents = await watch(
    'Document',
    PATTERNS['documents'],
    () => buildSdk(PATTERNS['schema'], PATTERNS['documents']),
    true
  )

  debug('Initial scan complete')

  if (process.env.FAUGRA_NO_WATCH) {
    queue.onIdle().then(() => {
      runCallback()

      console.log('All operations complete')
      process.exit(0)
    })
  } else {
    let started = false

    const spinner = ora({
      text: `All done! Waiting for new file changes 🦆`,
      prefixText: '\n',
      spinner: 'bounce',
    })

    queue.on('active', () => {
      started = true
      spinner.stop()
    })

    queue.on('idle', () => {
      if (started) {
        runCallback()
      }

      spinner.start()
    })
  }

  queue.start()
}

if (require.main === module) {
  let startup = Promise.resolve()

  if (process.env.FAUGRA_OVERWRITE) {
    startup = require('./reset')()
  }

  startup.then(main)
}

module.exports = main
