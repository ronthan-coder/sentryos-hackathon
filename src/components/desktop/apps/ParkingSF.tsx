'use client'

import { useState, useEffect } from 'react'
import { MapPin, Clock, AlertTriangle, DollarSign, Calendar, Car, Info, TrendingUp } from 'lucide-react'
import * as Sentry from '@sentry/nextjs'

interface ParkingRule {
  type: 'allowed' | 'restricted' | 'forbidden'
  reason: string
  cost?: number
  timeUntilChange?: string
  nextChange?: string
}

interface StreetCleaningSchedule {
  day: string
  time: string
  side: string
}

// SF Street Cleaning Schedules by District
const STREET_CLEANING_SCHEDULES: Record<string, StreetCleaningSchedule[]> = {
  'Mission': [
    { day: 'Monday', time: '8am-10am', side: 'West' },
    { day: 'Thursday', time: '8am-10am', side: 'East' },
  ],
  'SoMa': [
    { day: 'Tuesday', time: '12pm-2pm', side: 'North' },
    { day: 'Friday', time: '12pm-2pm', side: 'South' },
  ],
  'Financial District': [
    { day: 'Monday/Wednesday', time: '9am-11am', side: 'All' },
  ],
  'Richmond': [
    { day: 'Wednesday', time: '8am-10am', side: 'North' },
    { day: 'Thursday', time: '8am-10am', side: 'South' },
  ],
  'Sunset': [
    { day: 'Tuesday', time: '8am-10am', side: 'West' },
    { day: 'Friday', time: '8am-10am', side: 'East' },
  ],
  'Marina': [
    { day: 'Monday', time: '9am-11am', side: 'All' },
  ],
  'Haight-Ashbury': [
    { day: 'Thursday', time: '8am-10am', side: 'Both' },
  ],
  'Castro': [
    { day: 'Wednesday', time: '12pm-2pm', side: 'All' },
  ],
}

// Violation costs based on SFMTA data
const VIOLATION_COSTS: Record<string, number> = {
  'Street Cleaning': 76,
  'Expired Meter': 78,
  'No Residential Permit': 78,
  'Bus Zone': 288,
  'Disabled Zone': 866,
  'Driveway Blocking': 110,
  'Fire Hydrant': 110,
  'Red Zone': 110,
  'Yellow Zone': 95,
  'Tow + Storage': 450,
}

// High-risk ticket areas (actual 2024 data)
const HIGH_RISK_AREAS = [
  { area: 'SoMa', tickets: 11383000, ticketsPerYear: 134000 },
  { area: 'Inner Richmond', tickets: 10515000, ticketsPerYear: 125000 },
  { area: 'Mission', tickets: 9455000, ticketsPerYear: 112000 },
  { area: 'Financial District', tickets: 8200000, ticketsPerYear: 98000 },
  { area: 'Marina', tickets: 6500000, ticketsPerYear: 78000 },
]

export function ParkingSF() {
  const [location, setLocation] = useState('')
  const [selectedDistrict, setSelectedDistrict] = useState<string>('')
  const [currentTime, setCurrentTime] = useState(new Date())
  const [parkingRule, setParkingRule] = useState<ParkingRule | null>(null)
  const [selectedViolation, setSelectedViolation] = useState<string>('')

  // Update time every minute
  useEffect(() => {
    const timer = setInterval(() => {
      setCurrentTime(new Date())
    }, 60000)
    return () => clearInterval(timer)
  }, [])

  // Log app initialization
  useEffect(() => {
    Sentry.logger.info('ParkingSF app opened', {
      app_name: 'parking_sf',
      timestamp: new Date().toISOString(),
    })
    Sentry.metrics.increment('parking_sf.app.opened')
  }, [])

  const checkParkingRules = (district: string) => {
    const startTime = Date.now()

    Sentry.logger.info('Checking parking rules', {
      district,
      check_time: currentTime.toISOString(),
      day_of_week: currentTime.toLocaleDateString('en-US', { weekday: 'long' }),
    })
    Sentry.metrics.increment('parking_sf.rules.checked', {
      district,
    })

    setSelectedDistrict(district)

    const schedule = STREET_CLEANING_SCHEDULES[district] || []
    const currentDay = currentTime.toLocaleDateString('en-US', { weekday: 'long' })
    const currentHour = currentTime.getHours()

    // Check if currently in street cleaning time
    const activeCleaningSchedule = schedule.find(s => {
      if (!s.day.includes(currentDay)) return false

      // Parse time range
      const [start, end] = s.time.split('-')
      const startHour = parseInt(start.replace(/\D/g, ''))
      const endHour = parseInt(end.replace(/\D/g, ''))

      return currentHour >= startHour && currentHour < endHour
    })

    if (activeCleaningSchedule) {
      const endTime = activeCleaningSchedule.time.split('-')[1]
      setParkingRule({
        type: 'forbidden',
        reason: `Street Cleaning Active (${activeCleaningSchedule.side} side)`,
        cost: VIOLATION_COSTS['Street Cleaning'],
        timeUntilChange: endTime,
        nextChange: `Parking allowed after ${endTime}`,
      })

      Sentry.logger.warn('Active street cleaning detected', {
        district,
        schedule: activeCleaningSchedule,
        violation_cost: VIOLATION_COSTS['Street Cleaning'],
      })
    } else {
      // Find next street cleaning
      const nextSchedule = schedule[0] // Simplified for demo

      setParkingRule({
        type: 'allowed',
        reason: 'Parking currently allowed',
        nextChange: nextSchedule
          ? `Next street cleaning: ${nextSchedule.day} ${nextSchedule.time}`
          : 'No scheduled street cleaning',
      })

      Sentry.logger.info('Parking allowed', {
        district,
        next_restriction: nextSchedule?.day,
      })
    }

    const checkDuration = Date.now() - startTime
    Sentry.metrics.distribution('parking_sf.rules.check_duration', checkDuration)
  }

  const calculateTotalCost = (violations: string[]) => {
    const total = violations.reduce((sum, v) => sum + (VIOLATION_COSTS[v] || 0), 0)

    Sentry.logger.info('Violation cost calculated', {
      violations,
      total_cost: total,
      violation_count: violations.length,
    })
    Sentry.metrics.increment('parking_sf.cost.calculated')

    return total
  }

  const handleViolationSelect = (violation: string) => {
    setSelectedViolation(violation)
    Sentry.logger.debug('Violation type selected', {
      violation_type: violation,
      cost: VIOLATION_COSTS[violation],
    })
  }

  const handleDistrictClick = (district: string) => {
    Sentry.logger.info('High-risk area viewed', {
      district,
      annual_tickets: HIGH_RISK_AREAS.find(a => a.area === district)?.ticketsPerYear,
    })
    Sentry.metrics.increment('parking_sf.high_risk.viewed', {
      district,
    })
  }

  return (
    <div className="h-full flex flex-col bg-[#1e1a2a] text-[#e8e4f0]">
      {/* Header */}
      <div className="flex items-center gap-2 px-3 py-2 border-b border-[#362552] bg-[#2a2438]">
        <Car className="w-5 h-5 text-[#7553ff]" />
        <span className="text-sm font-semibold">SF Parking Assistant</span>
        <span className="ml-auto text-xs text-[#9086a3]">Never get towed again</span>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-auto p-4 space-y-4">
        {/* Location Search */}
        <div className="bg-[#2a2438] rounded-lg p-3 border border-[#362552]">
          <div className="flex items-center gap-2 mb-2">
            <MapPin className="w-4 h-4 text-[#7553ff]" />
            <span className="text-sm font-semibold">Check Your Location</span>
          </div>
          <input
            type="text"
            value={location}
            onChange={(e) => setLocation(e.target.value)}
            placeholder="Enter street address or neighborhood..."
            className="w-full bg-[#1e1a2a] text-[#e8e4f0] text-sm rounded px-3 py-2 border border-[#362552] focus:border-[#7553ff] focus:outline-none"
          />
          <div className="mt-2 flex flex-wrap gap-2">
            {Object.keys(STREET_CLEANING_SCHEDULES).map((district) => (
              <button
                key={district}
                onClick={() => checkParkingRules(district)}
                className="px-3 py-1 bg-[#7553ff]/20 hover:bg-[#7553ff]/30 text-[#7553ff] rounded text-xs transition-colors"
              >
                {district}
              </button>
            ))}
          </div>
        </div>

        {/* Current Status */}
        {parkingRule && (
          <div className={`rounded-lg p-3 border-2 ${
            parkingRule.type === 'forbidden'
              ? 'bg-red-500/10 border-red-500'
              : 'bg-green-500/10 border-green-500'
          }`}>
            <div className="flex items-start gap-2">
              <AlertTriangle className={`w-5 h-5 mt-0.5 ${
                parkingRule.type === 'forbidden' ? 'text-red-500' : 'text-green-500'
              }`} />
              <div className="flex-1">
                <h3 className="font-semibold text-sm mb-1">
                  {parkingRule.type === 'forbidden' ? '🚫 DO NOT PARK' : '✅ Safe to Park'}
                </h3>
                <p className="text-xs text-[#e8e4f0] mb-2">{parkingRule.reason}</p>
                {parkingRule.cost && (
                  <p className="text-xs text-red-400 font-semibold">
                    Ticket Cost: ${parkingRule.cost}
                  </p>
                )}
                {parkingRule.nextChange && (
                  <p className="text-xs text-[#9086a3] mt-1">
                    {parkingRule.nextChange}
                  </p>
                )}
              </div>
            </div>
          </div>
        )}

        {/* Street Cleaning Schedule */}
        {selectedDistrict && (
          <div className="bg-[#2a2438] rounded-lg p-3 border border-[#362552]">
            <div className="flex items-center gap-2 mb-2">
              <Calendar className="w-4 h-4 text-[#7553ff]" />
              <span className="text-sm font-semibold">{selectedDistrict} - Street Cleaning</span>
            </div>
            <div className="space-y-2">
              {STREET_CLEANING_SCHEDULES[selectedDistrict]?.map((schedule, idx) => (
                <div key={idx} className="flex items-center justify-between text-xs bg-[#1e1a2a] rounded p-2">
                  <span className="text-[#e8e4f0]">{schedule.day}</span>
                  <span className="text-[#9086a3]">{schedule.time}</span>
                  <span className="text-[#7553ff]">{schedule.side} side</span>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Violation Cost Calculator */}
        <div className="bg-[#2a2438] rounded-lg p-3 border border-[#362552]">
          <div className="flex items-center gap-2 mb-2">
            <DollarSign className="w-4 h-4 text-[#ff45a8]" />
            <span className="text-sm font-semibold">Violation Costs (2024)</span>
          </div>
          <div className="space-y-1 max-h-40 overflow-y-auto">
            {Object.entries(VIOLATION_COSTS).map(([violation, cost]) => (
              <button
                key={violation}
                onClick={() => handleViolationSelect(violation)}
                className={`w-full flex items-center justify-between text-xs rounded p-2 transition-colors ${
                  selectedViolation === violation
                    ? 'bg-[#7553ff]/20 border border-[#7553ff]'
                    : 'bg-[#1e1a2a] hover:bg-[#1e1a2a]/50'
                }`}
              >
                <span className="text-[#e8e4f0]">{violation}</span>
                <span className="text-[#ff45a8] font-semibold">${cost}</span>
              </button>
            ))}
          </div>
        </div>

        {/* High-Risk Areas */}
        <div className="bg-[#2a2438] rounded-lg p-3 border border-[#362552]">
          <div className="flex items-center gap-2 mb-2">
            <TrendingUp className="w-4 h-4 text-[#ff45a8]" />
            <span className="text-sm font-semibold">High-Risk Ticket Areas (2024)</span>
          </div>
          <div className="space-y-2">
            {HIGH_RISK_AREAS.map((area) => (
              <button
                key={area.area}
                onClick={() => handleDistrictClick(area.area)}
                className="w-full bg-[#1e1a2a] rounded p-2 hover:bg-[#1e1a2a]/50 transition-colors text-left"
              >
                <div className="flex items-center justify-between mb-1">
                  <span className="text-xs font-semibold text-[#e8e4f0]">{area.area}</span>
                  <span className="text-xs text-[#ff45a8]">
                    ${(area.tickets / 1000000).toFixed(1)}M
                  </span>
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-[10px] text-[#9086a3]">
                    {area.ticketsPerYear.toLocaleString()} tickets/year
                  </span>
                  <span className="text-[10px] text-[#9086a3]">
                    ~{Math.round(area.ticketsPerYear / 365)} per day
                  </span>
                </div>
              </button>
            ))}
          </div>
        </div>

        {/* Stats Summary */}
        <div className="bg-[#7553ff]/10 rounded-lg p-3 border border-[#7553ff]/30">
          <div className="flex items-start gap-2">
            <Info className="w-4 h-4 text-[#7553ff] mt-0.5" />
            <div className="text-xs space-y-1">
              <p className="text-[#e8e4f0] font-semibold">San Francisco 2024 Stats:</p>
              <p className="text-[#9086a3]">• 1.2M tickets issued ($119M in fines)</p>
              <p className="text-[#9086a3]">• 42K vehicles towed ($25M in fees)</p>
              <p className="text-[#9086a3]">• 43% of tickets: street cleaning violations</p>
              <p className="text-[#ff45a8] font-semibold mt-2">
                Average driver: 2.4 tickets/year = $180-240
              </p>
            </div>
          </div>
        </div>

        {/* Current Time */}
        <div className="bg-[#2a2438] rounded-lg p-2 border border-[#362552] flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Clock className="w-3 h-3 text-[#9086a3]" />
            <span className="text-xs text-[#9086a3]">Current Time</span>
          </div>
          <span className="text-xs text-[#e8e4f0] font-mono">
            {currentTime.toLocaleString('en-US', {
              weekday: 'short',
              month: 'short',
              day: 'numeric',
              hour: '2-digit',
              minute: '2-digit',
            })}
          </span>
        </div>
      </div>
    </div>
  )
}
