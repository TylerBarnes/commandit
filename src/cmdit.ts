import { execa, ExecaChildProcess } from "execa"
import assert from "node:assert"

export function cmdit(
  command: string,
  {
    args = [],
    cwd = process.cwd(),
    env = {},
    verbose = false,
  }: {
    args?: string[]
    cwd?: string
    env?: Record<string, string>
    verbose?: boolean
  } = {}
) {
  return new Cmdit({
    command,
    args,
    cwd,
    env,
    verbose,
  })
}

type QueueKill = {
  type: "kill"
}
type QueueInput = {
  type: "sendInput"
  input: string
}
type QueueEffect = {
  type: "effect"
  effect: () => Promise<void> | void
}
type QueueLine = {
  type: "nextLineIs"
  line: string
  callback?: () => Promise<void> | void
}
type QueueUpcomingLine = {
  type: "whenLineIs"
  line: string
  callback?: () => Promise<void> | void
}

type QueueItem =
  | QueueLine
  | QueueUpcomingLine
  | QueueEffect
  | QueueInput
  | QueueKill

class Cmdit {
  public async done() {
    this.guardMethodCall(`done`)

    if (this.eventQueue.length === 0) {
      throw new Error(
        `cmdit().done() called with an empty queue. Please add some assertions and method chains before calling done().`
      )
    }

    if (this.verbose) {
      console.log(
        `[cmdit] starting process: ${this.command} ${this.args.join(` `)}`
      )
    }

    this.childProcess = execa(this.command, this.args, {
      cwd: this.cwd,
      env: this.env,
      stdio: [`pipe`, `pipe`, `pipe`],
      shell: true,
    })

    this.childProcess!.stdout!.on(`data`, this.handleOutputBuffer(`stdout`))
    this.childProcess!.stderr!.on(`data`, this.handleOutputBuffer(`stderr`))

    await new Promise((resolve, reject) => {
      let loggedExit = false
      this.childProcess!.on(`close`, (code) => {
        if (code === 0 || code === 143) {
          resolve(null)
        } else {
          if (!loggedExit) {
            console.log(`[cmdit] process closed with code ${code}`)
          }
          loggedExit = true
          reject(code)
        }
      })
      this.childProcess!.on(`exit`, (code) => {
        if (code === 0 || code === 143) {
          resolve(null)
        } else {
          if (!loggedExit) {
            console.log(`[cmdit] process exited with code ${code}`)
          }
          loggedExit = true
          reject(code)
        }
      })
    })
  }
  public nextLineIs(line: string, callback?: () => void) {
    this.guardMethodCall(`nextLineIs`)

    this.eventQueue.push({
      type: "nextLineIs",
      line,
      callback,
    })

    return this
  }
  public whenLineIs(line: string, callback?: () => void) {
    this.guardMethodCall(`whenLineIs`)

    this.eventQueue.push({
      type: "whenLineIs",
      line,
      callback,
    })

    return this
  }
  public effect(effect: QueueEffect["effect"]) {
    this.guardMethodCall(`effect`)

    this.eventQueue.push({
      type: "effect",
      effect,
    })

    return this
  }
  public sendInput(input: string) {
    this.guardMethodCall(`sendInput`)

    this.eventQueue.push({
      type: "sendInput",
      input,
    })

    return this
  }
  public kill() {
    this.guardMethodCall(`kill`)

    this.eventQueue.push({
      type: "kill",
    })

    this.done()
  }

  private childProcess: ExecaChildProcess
  private command: string
  private args: string[]
  private cwd: string
  private env: Record<string, string>
  private verbose: boolean
  private eventQueue: QueueItem[] = []
  private lineQueue: {
    type: `stdout` | `stderr`
    line: string
  }[] = []
  private running = false
  private methodCalls = new Set()

  constructor({
    command,
    args = [],
    cwd = process.cwd(),
    env = {},
    verbose = false,
  }: {
    command: string
    args?: string[]
    cwd?: string
    env?: Record<string, string>
    verbose?: boolean
  }) {
    if (command.includes(" ")) {
      const [realCommand, ...commandArgs] = command.split(" ")
      args = [...commandArgs, ...args]

      command = realCommand
    }

    this.command = command
    this.args = args
    this.cwd = cwd
    this.env = env
    this.verbose = verbose
  }

  private guardMethodCall(name: string) {
    if (name === `start` && this.methodCalls.has(`start`)) {
      throw new Error(`cmdit().start() can only be called once per instance.`)
    }

    if (name !== `start` && this.methodCalls.has(`start`)) {
      throw new Error(
        `cmdit().${name}() can only be called before cmdit().start(). 'start' begins running the process, and all assertions must be queued before the process starts.`
      )
    }

    if (this.verbose) {
      console.log(`[cmdit] queuing ${name}`)
    }

    this.methodCalls.add(name)
  }

  private nextEventIsSideEffect() {
    return [`effect`, `sendInput`, `kill`].includes(this.eventQueue[0]?.type)
  }
  private async run() {
    if (this.running) return

    this.running = true
    while (await this.handleNextSideEffect());
    while (await this.handleNextLine());
    this.running = false

    if (this.nextEventIsSideEffect()) this.run()
  }
  private destruct() {
    this.childProcess.kill()
    this.eventQueue = []
    this.lineQueue = []
    return false
  }
  private async handleNextLine() {
    if (this.nextEventIsSideEffect()) return false

    const nextEvent = this.eventQueue[0]
    const nextLine = this.lineQueue[0]

    if (!nextEvent || !nextLine) return false

    if (nextEvent.type === `whenLineIs` && nextEvent.line !== nextLine.line) {
      // remove the line from the queue,
      this.lineQueue.shift()
      // maybe the next one is the one we're waiting for.
      return true // return true means it's still running
    }

    const event = this.eventQueue.shift()!
    const line = this.lineQueue.shift()!

    if (`line` in event && event.line) {
      assert.equal(line.line, event.line)
    }

    if (`callback` in event && event.callback) {
      await event.callback()
    }

    return true
  }

  private async handleNextSideEffect(): Promise<boolean> {
    if (!this.nextEventIsSideEffect()) return false

    const event = this.eventQueue.shift()!

    if (event.type === `kill`) {
      return this.destruct()
    }

    if (event.type === `sendInput`) {
      this.childProcess.stdin!.write(event.input + `\n`)
    }

    if (event.type === `effect`) {
      await event.effect()
    }

    return true
  }
  private handleOutputBuffer(type: "stdout" | "stderr") {
    return (data: Buffer) => {
      if (this.verbose) {
        console[type === `stdout` ? `log` : `error`](data.toString())
      }

      for (const line of data.toString().split(`\n`)) {
        if (line === `Debugger attached.` || !line || line === ``) {
          continue
        }

        this.lineQueue.push({
          type,
          line,
        })
      }

      if (this.lineQueue.length > 0) {
        this.run()
      }
    }
  }
}
