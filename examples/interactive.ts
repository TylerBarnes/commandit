import readline from "readline"
readline.emitKeypressEvents(process.stdin)
process.stdin?.setRawMode?.(true)

//
;(async () => {
  console.log(`started!`)
  console.log(`hi`)
  console.log(`hi ok`)
  console.log(`what up`)
  setTimeout(() => {
    console.log(`waited`)
  }, 1000)

  process.stdin.on("keypress", (_str, key) => {
    if (key.name === "t") {
      setTimeout(() => {
        console.log(`t pressed`)
      }, 1000)
    }

    if (key.name === "x" || (key.name === "c" && key.ctrl)) {
      console.log(`exiting`)
      process.exit()
    }
  })

  setInterval(() => {}, 1000)
})()
