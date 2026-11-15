import React from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { useApp } from '../store'
import Layout from '../components/Layout'
import AttendanceSheet from '../components/AttendanceSheet'
import { Empty, Button } from '../ui'

export default function Attendance() {
  const { id } = useParams()
  const { db } = useApp()
  const nav = useNavigate()
  const session = db.sessions.find((s) => s.id === id)

  return (
    <Layout title="点名消课">
      {session ? (
        <AttendanceSheet session={session} />
      ) : (
        <div className="rounded-2xl border border-slate-200 bg-white p-10">
          <Empty text="课次不存在或已被删除" />
          <div className="flex justify-center">
            <Button variant="soft" onClick={() => nav('/')}>
              返回首页
            </Button>
          </div>
        </div>
      )}
    </Layout>
  )
}
