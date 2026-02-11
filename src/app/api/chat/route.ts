import { query } from '@anthropic-ai/claude-agent-sdk'
import * as Sentry from '@sentry/nextjs'

const SYSTEM_PROMPT = `You are a helpful personal assistant designed to help with general research, questions, and tasks.

Your role is to:
- Answer questions on any topic accurately and thoroughly
- Help with research by searching the web for current information
- Assist with writing, editing, and brainstorming
- Provide explanations and summaries of complex topics
- Help solve problems and think through decisions

Guidelines:
- Be friendly, clear, and conversational
- Use web search when you need current information, facts you're unsure about, or real-time data
- Keep responses concise but complete - expand when the topic warrants depth
- Use markdown formatting when it helps readability (bullet points, code blocks, etc.)
- Be honest when you don't know something and offer to search for answers`

interface MessageInput {
  role: 'user' | 'assistant'
  content: string
}

export async function POST(request: Request) {
  try {
    const { messages } = await request.json() as { messages: MessageInput[] }

    // Log request started
    Sentry.logger.info('Chat API request started', {
      message_count: messages?.length || 0,
    })

    if (!messages || !Array.isArray(messages)) {
      Sentry.logger.warn('Invalid request: messages array missing', {
        error_type: 'validation_error',
      })
      return new Response(
        JSON.stringify({ error: 'Messages array is required' }),
        { status: 400, headers: { 'Content-Type': 'application/json' } }
      )
    }

    // Get the last user message
    const lastUserMessage = messages.filter(m => m.role === 'user').pop()
    if (!lastUserMessage) {
      Sentry.logger.warn('Invalid request: no user message found', {
        error_type: 'validation_error',
        message_count: messages.length,
      })
      return new Response(
        JSON.stringify({ error: 'No user message found' }),
        { status: 400, headers: { 'Content-Type': 'application/json' } }
      )
    }

    // Build conversation context
    const conversationContext = messages
      .slice(0, -1) // Exclude the last message since we pass it as the prompt
      .map((m: MessageInput) => `${m.role === 'user' ? 'User' : 'Assistant'}: ${m.content}`)
      .join('\n\n')

    const fullPrompt = conversationContext
      ? `${SYSTEM_PROMPT}\n\nPrevious conversation:\n${conversationContext}\n\nUser: ${lastUserMessage.content}`
      : `${SYSTEM_PROMPT}\n\nUser: ${lastUserMessage.content}`

    // Log query start and track metrics
    const queryStartTime = Date.now()
    Sentry.logger.info('Starting Claude query', {
      user_message_length: lastUserMessage.content.length,
      conversation_length: messages.length,
    })
    Sentry.metrics.increment('chat.request.started')

    // Create a streaming response
    const encoder = new TextEncoder()
    let streamChunkCount = 0
    let toolsExecuted = 0
    const toolExecutions: string[] = []

    const stream = new ReadableStream({
      async start(controller) {
        try {
          // Use the claude-agent-sdk query function with all default tools enabled
          for await (const message of query({
            prompt: fullPrompt,
            options: {
              maxTurns: 10,
              // Use the preset to enable all Claude Code tools including WebSearch
              tools: { type: 'preset', preset: 'claude_code' },
              // Bypass all permission checks for automated tool execution
              permissionMode: 'bypassPermissions',
              allowDangerouslySkipPermissions: true,
              // Enable partial messages for real-time text streaming
              includePartialMessages: true,
              // Set working directory to the app's directory for sandboxing
              cwd: process.cwd(),
            }
          })) {
            // Handle streaming text deltas (partial messages)
            if (message.type === 'stream_event' && 'event' in message) {
              const event = message.event
              // Handle content block delta events for text streaming
              if (event.type === 'content_block_delta' && event.delta?.type === 'text_delta') {
                streamChunkCount++
                Sentry.logger.trace('Text delta received', {
                  chunk_length: event.delta.text.length,
                  total_chunks: streamChunkCount,
                })
                controller.enqueue(encoder.encode(
                  `data: ${JSON.stringify({ type: 'text_delta', text: event.delta.text })}\n\n`
                ))
              }
            }

            // Send tool start events from assistant messages
            if (message.type === 'assistant' && 'message' in message) {
              const content = message.message?.content
              if (Array.isArray(content)) {
                for (const block of content) {
                  if (block.type === 'tool_use') {
                    toolsExecuted++
                    toolExecutions.push(block.name)
                    Sentry.logger.info('Tool execution started', {
                      tool_name: block.name,
                      tools_executed: toolsExecuted,
                    })
                    Sentry.metrics.increment('chat.tool.execution', {
                      tool_name: block.name,
                    })
                    controller.enqueue(encoder.encode(
                      `data: ${JSON.stringify({ type: 'tool_start', tool: block.name })}\n\n`
                    ))
                  }
                }
              }
            }

            // Send tool progress updates
            if (message.type === 'tool_progress') {
              Sentry.logger.debug('Tool progress update', {
                tool_name: message.tool_name,
                elapsed_seconds: message.elapsed_time_seconds,
              })
              controller.enqueue(encoder.encode(
                `data: ${JSON.stringify({ type: 'tool_progress', tool: message.tool_name, elapsed: message.elapsed_time_seconds })}\n\n`
              ))
            }

            // Signal completion
            if (message.type === 'result' && message.subtype === 'success') {
              const streamDuration = Date.now() - queryStartTime
              Sentry.logger.info('Chat request completed successfully', {
                stream_duration_ms: streamDuration,
                stream_chunks: streamChunkCount,
                tools_executed: toolsExecuted,
                tool_names: toolExecutions.join(', '),
              })
              Sentry.metrics.increment('chat.request.completed')
              Sentry.metrics.distribution('chat.stream.duration', streamDuration)
              Sentry.metrics.gauge('chat.stream.chunks', streamChunkCount)
              Sentry.metrics.gauge('chat.tools.executed', toolsExecuted)
              controller.enqueue(encoder.encode(
                `data: ${JSON.stringify({ type: 'done' })}\n\n`
              ))
            }

            // Handle errors
            if (message.type === 'result' && message.subtype !== 'success') {
              Sentry.logger.error('Query did not complete successfully', {
                error_type: 'query_failure',
                result_subtype: message.subtype,
              })
              Sentry.metrics.increment('chat.request.failed', {
                failure_type: message.subtype,
              })
              controller.enqueue(encoder.encode(
                `data: ${JSON.stringify({ type: 'error', message: 'Query did not complete successfully' })}\n\n`
              ))
            }
          }

          controller.enqueue(encoder.encode('data: [DONE]\n\n'))
          controller.close()
        } catch (error) {
          Sentry.logger.error('Stream error occurred', {
            error_type: 'stream_error',
            error_message: error instanceof Error ? error.message : 'Unknown error',
          })
          Sentry.captureException(error)
          Sentry.metrics.increment('chat.error.stream')
          controller.enqueue(encoder.encode(
            `data: ${JSON.stringify({ type: 'error', message: 'Stream error occurred' })}\n\n`
          ))
          controller.close()
        }
      }
    })

    return new Response(stream, {
      headers: {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        'Connection': 'keep-alive',
      },
    })
  } catch (error) {
    Sentry.logger.error('Chat API error', {
      error_type: 'api_error',
      error_message: error instanceof Error ? error.message : 'Unknown error',
    })
    Sentry.captureException(error)

    return new Response(
      JSON.stringify({ error: 'Failed to process chat request. Check server logs for details.' }),
      { status: 500, headers: { 'Content-Type': 'application/json' } }
    )
  }
}
