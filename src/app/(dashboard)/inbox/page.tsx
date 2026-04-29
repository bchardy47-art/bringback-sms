import { MessageSquare } from 'lucide-react'

export default function InboxPage() {
  return (
    <div className="flex-1 flex items-center justify-center h-full bg-gray-50">
      <div className="text-center">
        <div className="w-16 h-16 rounded-2xl bg-gray-100 flex items-center justify-center mx-auto mb-4">
          <MessageSquare size={28} className="text-gray-400" />
        </div>
        <h2 className="text-base font-semibold text-gray-700">Select a conversation</h2>
        <p className="text-sm text-gray-400 mt-1">Choose a conversation from the list to get started</p>
      </div>
    </div>
  )
}
