import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'fs';
import { unionBy } from 'lodash';
import { convert, create } from 'xmlbuilder2';
import Generator from 'yeoman-generator';
import { CharacterMap, Characters } from './maps/Characters';
import { dirname } from 'path'
import { DefaultPRC } from './maps/DefaultPRC';

function searchChars(char: string): CharacterMap[] {
  char = char.toLowerCase()
  const ret = [];
  const reg = new RegExp(char, 'i')
  for (const charMap of Characters) {
    if(charMap[1] === char || charMap[2].match(reg)){
      ret.push(charMap)
    }
  }
  return ret
}

enum SaveMode {
  "Add",
  "Replace"
}

interface IAnswers {
  name: string
  character: CharacterMap
  slot: number
  title: string
  mode: SaveMode
}

type MSBTEntry = {
  "@label": string
  title: string
}

type MSBT = {
  xmsbt: {
    entry: MSBTEntry[]
  }
}

type Dummy = {
  "@index": string
  "#": "dummy"
}

type DummyList = {
  hash40: Dummy[]
}

type ByteEntry = {
  "@hash": string,
  "#": string
}

type IDList = {
  "struct": {
    "@index": string,
    "byte": ByteEntry[]
  }
}

type PRC = {
  struct: {
    list: {
      "@hash": "db_root",
      "#": (DummyList | IDList) []
    }
  }
}

enum EntryType {
  Start,
  Dummy,
  Struct
}

const MSBT_PATH = "ui/message/msg_name.xmsbt"
const PRC_PATH = "ui/param/database/ui_chara_db.prcx"

const generateDummies = (startId: number, count: number = 1) => {
  const dummies = [

  ]
  for(let i = 0; i < count; i++) {
    dummies.push({
      "@index": ""+(startId+i),
      "#": "dummy"
    })
  }
  return {
    hash40: dummies
  }
}

const generateEntries = (slot: string, char: string, title: string): MSBTEntry[] => {
  return [
    {
      "@label": `ui_chr1_${slot}_${char}`,
      title: title
    },
    {
      "@label": `ui_chr2_${slot}_${char}`,
      title: title.toUpperCase()
    }
  ]
}

const EntryLabelReg = /ui_chr1_(\d{2})_(\w+)/

const generatePRCXFromXMSBT = (xmsbt: MSBT) => {
  const contents: PRC = {
    struct: {
      list: {
        "@hash": "db_root",
        "#": []
      }
    }
  }

  const entries: Record<number, string[] | string> = {
    ...DefaultPRC
  }

  xmsbt.xmsbt.entry.forEach(entry => {
    const matches = EntryLabelReg.exec(entry['@label'])
    if(matches) {
      const slot = matches[1]
      const id = searchChars(matches[2])[0][0];
      if(typeof entries[id] === "string") entries[id] = [];
      (entries[id] as Array<string>).push(slot)
    }
  })

  let lastType = EntryType.Start

  Object.entries(entries).forEach(entry => {
    const type = (typeof entry[1] === "string") ? EntryType.Dummy : EntryType.Struct
    if(lastType !== type && type == EntryType.Dummy) {
      contents.struct.list['#'].push(
        {
          "hash40": []
        }
      )
    }
    lastType = type
    if(type === EntryType.Dummy) {
      (contents.struct.list["#"][contents.struct.list["#"].length-1] as DummyList)
      .hash40.push({
        "@index": entry[0],
        "#": "dummy"
      })
    } else {
      contents.struct.list["#"].push({
        struct: {
          "@index": entry[0],
          "byte": (entry[1] as string[]).map((slot) => {
            return {
              "@hash": slot,
              "#": ""+parseInt(slot)
            }
          })
        }
      })
    }
  })

  const prc = create(
    { version: "1.0", encoding: "utf-8"},
    contents
  )
  return prc.end({ prettyPrint: true })
}

module.exports = class extends Generator {
  private answers!: IAnswers
  async prompting(){

    let choices: CharacterMap[] = []
    const prompts: Generator.Questions<IAnswers> = [
      {
        type: "input",
        name: "name",
        message: "Character",
        default: "mario",
        validate: (input) => {
          choices = searchChars(input)
          return (choices.length > 0) || "Not found"
        }
      },
      {
        when: () => {
          return choices.length > 1
        },
        type: "list",
        name: "character",
        message: "Which character",
        default: 0,
        choices: () => choices.map(charMap => charMap[2]),
        filter: (input) => {
          return choices.find(charMap => charMap[2] === input)
        }
      },
      {
        type: "list",
        name: "slot",
        message: "Slot",
        default: 0,
        choices: [1, 2, 3, 4, 5, 6, 7, 8],
        filter: (input) => {
          return input - 1
        }
      },
      {
        type: "input",
        name: "title",
        message: "Title",
        required: true
      },
      {
        when: () => {
          // check if file already exists
          return existsSync(this.destinationPath(MSBT_PATH))
        },
        type: "list",
        message: "File already exists, do you want to add or replace?",
        name: "mode",
        choices: ["Add", "Replace"],
        filter: (input, answers) => {
          return SaveMode[input]
        }
      }
    ];
    return this.prompt(prompts).then(props => {
      if (props.character === undefined) {
        props.character = choices[0]
      }
      if (props.mode === undefined) {
        props.mode = SaveMode.Replace
      }
      this.answers = props;
    });
  }
  private _private_save_utf16(filePath: string, contents: string){
    const path = dirname(filePath)
    if(!existsSync(this.destinationPath(path))){
      mkdirSync(path, { recursive: true })
    }
    writeFileSync(
      filePath,
      contents,
      {
        flag: "w+",
        encoding: "utf16le"
      }
    )
  }
  private _private_update() {
    const slot = "0" + this.answers.slot
    const [id, char] = this.answers.character
    const newEntries = generateEntries(slot, char, this.answers.title)

    const msbtxml = readFileSync(MSBT_PATH).toString("utf16le")
    const msbt = convert(msbtxml, { format: "object" }) as MSBT

    msbt.xmsbt.entry = unionBy(msbt.xmsbt.entry, newEntries, '@label')
    this._private_save_utf16(
      this.destinationPath(MSBT_PATH),
      create(
        { version: "1.0", encoding: "utf-16" },
        msbt
      ).end({ prettyPrint: true })
    )

    const prc = generatePRCXFromXMSBT(msbt)
    
    writeFileSync(
      this.destinationPath(PRC_PATH),
      prc
    )
  }
  private _private_create() {
    const slot = "0" + this.answers.slot
    const [, char] = this.answers.character
    const msbt = create(
      { version: "1.0", encoding: "utf-16" },
      {
        xmsbt: {
          entry: generateEntries(slot, char, this.answers.title)
        }
      }
    )

    this._private_save_utf16(
      this.destinationPath(MSBT_PATH),
      msbt.end({prettyPrint: true})
    )
    
    writeFileSync(
      this.destinationPath(PRC_PATH),
      generatePRCXFromXMSBT(msbt.end({format: 'object'}) as MSBT)
    )
  }
  writing() {
    if (this.answers.mode === SaveMode.Add) {
      this._private_update()
    } else {
      this._private_create()
    }
  }
}