import {
  writeFileSync,
  mkdirSync,
  existsSync,
  copyFileSync,
  constants,
} from 'node:fs'
import { resolve } from 'node:path'
import { createHash } from 'node:crypto'
import { rimrafSync } from 'rimraf'

interface ASTNode {
  name: string
  type: 'file' | 'directory'
  children: Array<ASTNode>
}

type OpIfFileExist = ((fullpath: string) => void) | undefined

export default function main(
  template: string,
  indent = ' ',
  target = './',
  opIfFileExist: OpIfFileExist = undefined,
) {
  const rows = template.split('\n').filter(Boolean)

  const tokens = generateTokens(rows, indent)
  try {
    generateFS(tokens, target, opIfFileExist)
  } catch (error) {
    console.error(error)
    cancelAll()
  }
}

function generateTokens(rows: string[], indent: string) {
  let index = 0
  const len = rows.length

  function adjustTypeByName(name: string) {
    const pointIndex = name.indexOf('.')
    if (pointIndex === -1 || pointIndex >= name.length - 1) return 'directory'
    return 'file'
  }

  function splitIndent(row: string, indent: string) {
    let index = 0
    while (row.charAt(index) === indent) index++
    return {
      indentSize: index,
      name: row.slice(index),
    }
  }

  function middle(lastIndentSize = -1) {
    const res: ASTNode[] = []

    while (index < len) {
      const row = rows[index]
      const { indentSize, name } = splitIndent(row!, indent)
      // 每次创建一个节点时，都会尝试创建它的子节点以消耗更多的`row`
      if (indentSize > lastIndentSize) {
        ++index

        const node: ASTNode = {
          name,
          type: 'file',
          children: middle(indentSize),
        }

        // 如果存在children，则一定是文件夹，否则根据后缀判断（有些文件夹可能带有后缀）
        node.type =
          node.children.length > 0 ? 'directory' : adjustTypeByName(name)
        res.push(node)
      } else if (indentSize <= lastIndentSize) break
    }

    return res
  }

  return middle()
}

const backup: Record<string, string> = {}
const getHash = (text: string) => {
  return createHash('sha256').update(text).digest('hex').substring(0, 8)
}

function generateFS(
  nodes: ASTNode['children'],
  target: string,
  opIfFileExist: OpIfFileExist,
) {
  for (const node of nodes) {
    const fullPath = resolve(target, node.name)

    if (node.type === 'file') {
      const exist = existsSync(fullPath)

      if (exist) {
        // 如果文件已经存在，备份，防止回退时误删
        const hashPath = resolve(target, getHash(node.name))

        copyFileSync(fullPath, hashPath) // 备份不需要被取消，所以直接使用同步，还方便最外层错误捕捉
        backup[fullPath] = hashPath
      } else backup[fullPath] = ''

      if (opIfFileExist !== undefined && exist) opIfFileExist(fullPath)
      else writeFileSync(fullPath, '')
    } else {
      if (!existsSync(fullPath)) {
        mkdirSync(fullPath)
        backup[fullPath] = ''
      }
      // 递归子目录
      generateFS(node.children, fullPath, opIfFileExist)
    }
  }
}

function cancelAll() {
  for (let [current, origin] of Object.entries<string>(backup)) {
    if (origin !== '') {
      copyFileSync(origin, current, constants.COPYFILE_FICLONE_FORCE)
      current = origin
    }
    rimrafSync(current)
  }
}
